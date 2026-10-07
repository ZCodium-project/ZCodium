import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import type { HookEventName, PluginDiagnostic } from "@zcode/contracts";
import { HookEventName as HookEventNameValue } from "@zcode/contracts";
import { fileExists, isRecord, resolveInside } from "./helpers.js";
import type { LoadedPlugin } from "./types.js";

const STANDARD_HOOKS_PATH = join("hooks", "hooks.json");
/**
 * Codex 插件规范把 hooks 放在插件根 `hooks.json`；ZCodium 原实现只探测
 * `hooks/hooks.json`，Codex 布局的 hooks 会被静默丢弃。
 * 仅在标准位置缺席时读取根文件：多生态插件可能同时维护两份、内容按生态定制
 * （例如钩子命令里的变量前缀不同），ZCodium 的运行时语义对齐 Claude 语境，
 * 以 `hooks/hooks.json` 为准，避免两份 hook 同时触发。
 */
const CODEX_HOOKS_PATH = "hooks.json";

const SUPPORTED_HOOK_EVENTS = new Set<string>(Object.values(HookEventNameValue));

interface PluginHookSource {
  rawHooks: unknown;
  sourcePath: string;
  wrapper: boolean;
}

/**
 * 统一发现插件 hook 来源文件，避免详情枚举和真实 loader 对 `hooks/hooks.json`
 * 与 `manifest.hooks` 的读取口径漂移。
 */
export function listPluginHookSources(input: {
  diagnostics: PluginDiagnostic[];
  loaded: LoadedPlugin;
}): PluginHookSource[] {
  const sources: PluginHookSource[] = [];
  const loadedHookPaths = new Set<string>();
  const standardHooksPath = join(input.loaded.rootPath, STANDARD_HOOKS_PATH);
  const codexHooksPath = join(input.loaded.rootPath, CODEX_HOOKS_PATH);

  // 优先 ZCode/Claude 约定的 hooks/hooks.json；缺席时回退到 Codex 的根 hooks.json。
  let primaryHooksPath: string | undefined;
  if (fileExists(standardHooksPath)) {
    primaryHooksPath = standardHooksPath;
  } else if (fileExists(codexHooksPath)) {
    primaryHooksPath = codexHooksPath;
  }

  if (primaryHooksPath) {
    const source = loadPluginHookSource({
      diagnostics: input.diagnostics,
      loaded: input.loaded,
      path: primaryHooksPath,
    });
    if (source) {
      sources.push(source);
      loadedHookPaths.add(realpathOrSelf(primaryHooksPath));
    }
  }

  const manifestHooks = input.loaded.manifest.hooks;
  if (manifestHooks === undefined) return sources;
  const hookSpecs = Array.isArray(manifestHooks) ? manifestHooks : [manifestHooks];

  for (const hookSpec of hookSpecs) {
    if (typeof hookSpec === "string") {
      const hookFilePath = resolveInside(input.loaded.rootPath, hookSpec);
      if (!hookFilePath) {
        input.diagnostics.push({
          code: "plugin_component_path_invalid",
          message: `Plugin hooks path escapes plugin root: ${hookSpec}`,
          path: input.loaded.manifestPath,
          pluginId: input.loaded.id,
          severity: "error",
        });
        continue;
      }
      if (!fileExists(hookFilePath)) {
        input.diagnostics.push({
          code: "plugin_hook_read_failed",
          message: `Plugin hooks file not found: ${hookSpec}`,
          path: hookFilePath,
          pluginId: input.loaded.id,
          severity: "error",
        });
        continue;
      }

      const realPath = realpathOrSelf(hookFilePath);
      if (loadedHookPaths.has(realPath)) {
        input.diagnostics.push({
          code: "plugin_hook_invalid",
          message: `Duplicate plugin hooks file ignored: ${hookSpec}`,
          path: hookFilePath,
          pluginId: input.loaded.id,
          severity: "warning",
        });
        continue;
      }

      const source = loadPluginHookSource({
        diagnostics: input.diagnostics,
        loaded: input.loaded,
        path: hookFilePath,
      });
      if (source) {
        sources.push(source);
        loadedHookPaths.add(realPath);
      }
      continue;
    }

    sources.push({
      rawHooks: hookSpec,
      sourcePath: input.loaded.manifestPath,
      wrapper: false,
    });
  }

  return sources;
}

/** 只抽取 hook 事件名，供 `plugins/describe` 展示；不会构造可执行 hook。 */
export function listPluginHookEventNames(input: {
  diagnostics: PluginDiagnostic[];
  loaded: LoadedPlugin;
}): HookEventName[] {
  const eventNames: HookEventName[] = [];
  const seen = new Set<string>();
  for (const source of listPluginHookSources(input)) {
    const hooksRoot = source.wrapper
      ? isRecord(source.rawHooks)
        ? source.rawHooks.hooks
        : undefined
      : source.rawHooks;
    if (!isRecord(hooksRoot)) {
      input.diagnostics.push({
        code: "plugin_hook_invalid",
        message: source.wrapper
          ? "Plugin hooks file must contain a hooks object"
          : "Plugin manifest hooks entry must be an object, a path, or an array",
        path: source.sourcePath,
        pluginId: input.loaded.id,
        severity: "error",
      });
      continue;
    }
    for (const eventName of Object.keys(hooksRoot)) {
      if (!SUPPORTED_HOOK_EVENTS.has(eventName)) {
        input.diagnostics.push({
          code: "plugin_hook_unsupported_event",
          message: `Plugin hook event is not supported by this ZCode runtime: ${eventName}`,
          path: source.sourcePath,
          pluginId: input.loaded.id,
          severity: "warning",
        });
        continue;
      }
      if (seen.has(eventName)) continue;
      seen.add(eventName);
      eventNames.push(eventName as HookEventName);
    }
  }
  return eventNames;
}

function loadPluginHookSource(input: {
  diagnostics: PluginDiagnostic[];
  loaded: LoadedPlugin;
  path: string;
}): PluginHookSource | null {
  try {
    return {
      rawHooks: JSON.parse(readFileSync(input.path, "utf8")) as unknown,
      sourcePath: input.path,
      wrapper: true,
    };
  } catch (error) {
    input.diagnostics.push({
      code: "plugin_hook_read_failed",
      message:
        error instanceof Error ? error.message : `Failed to read plugin hooks: ${input.path}`,
      path: input.path,
      pluginId: input.loaded.id,
      severity: "error",
    });
    return null;
  }
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}
