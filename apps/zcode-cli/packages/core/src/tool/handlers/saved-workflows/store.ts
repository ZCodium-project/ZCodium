// ============================================================
// Saved workflows - 存储层（作用域根目录 + 解析 / 枚举 / 写入）
// ============================================================
//
// 全部是**同步** fs。理由不是图省事：确认窗的 `prepareApproval` 契约是同步的（core 的
// ToolEntry 注释：「it inspects the input the executor already holds」），而以 `saved` 源
// 发起的 run 必须在弹窗**之前**把脚本读出来——没有脚本就没有因果图，用户就会在一个空窗口上
// 批准执行。这些文件是本地的、单个的、以 KB 计的，同步读的代价远小于为它另开一条异步审批路径。
// core 的 handler 侧已有同一形态的先例（bash-git-runtime-safety.ts 的 readFileSync）。

import {
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  SAVED_WORKFLOW_FILE_EXTENSION,
  SAVED_WORKFLOW_GLOBAL_DIR,
  SAVED_WORKFLOW_MAX_NAME_CHARS,
  SAVED_WORKFLOW_PROJECT_DIR,
  isValidSavedWorkflowName,
  type SavedWorkflowEntry,
  type SavedWorkflowInvalidEntry,
  type SavedWorkflowMeta,
  type SavedWorkflowScope,
  type SavedWorkflowShadowing,
} from "@zcode/contracts";
import { parseSavedWorkflow, serializeSavedWorkflow } from "./frontmatter.js";

/** 一个查找根：作用域标签 + 绝对目录。 */
export interface SavedWorkflowRoot {
  scope: SavedWorkflowScope;
  dir: string;
}

/**
 * `savedWorkflowRoots` / 派生函数的可选参数。`homeDir` 只为测试注入：生产恒取
 * `os.homedir()`（agent 进程所在机器的家目录），**不**跟任何 `storage.dir` 配置走。
 */
export interface SavedWorkflowRootsOptions {
  homeDir?: string;
}

/**
 * 本次会话的查找根，**按优先级排列**：`[project, global]`。
 *
 * 项目档落在会话工作目录的 `.zcode/workflows/`，全局档落在家目录的 `~/.zcodium/workflows/`。
 * 所有查找按顺序 first-wins：项目里的那份永远赢过全局那份（同名遮蔽）。
 */
export function savedWorkflowRoots(
  cwd: string,
  options?: SavedWorkflowRootsOptions,
): SavedWorkflowRoot[] {
  return [
    { scope: "project", dir: join(cwd, SAVED_WORKFLOW_PROJECT_DIR) },
    { scope: "global", dir: join(options?.homeDir ?? homedir(), SAVED_WORKFLOW_GLOBAL_DIR) },
  ];
}

/** 单个作用域的查找根。作用域是已知枚举，`savedWorkflowRoots` 里必然有它。 */
export function savedWorkflowRoot(
  cwd: string,
  scope: SavedWorkflowScope,
  options?: SavedWorkflowRootsOptions,
): SavedWorkflowRoot {
  const root = savedWorkflowRoots(cwd, options).find((candidate) => candidate.scope === scope);
  // scope 是 SavedWorkflowScope 枚举成员，roots 覆盖全部成员，find 不会落空。
  return root!;
}

/** 一个解析成功的保存定义。 */
export interface ResolvedSavedWorkflow {
  name: string;
  path: string;
  scope: SavedWorkflowScope;
  meta: SavedWorkflowMeta;
  script: string;
  /**
   * 文件原文（元数据块 + 正文），**逐字节**。草稿拷贝拿的就是它：拷贝必须与刚读到的字节
   * 一模一样，重新序列化一遍会让 `args` 的默认值、注释与手写的 YAML 排版在拷贝里漂移，而
   * 那份拷贝正是模型接下来要 `path` 回传的东西。
   */
  source: string;
  /** 正文之前的行数；诊断转成文件行时加它（见 {@link parseSavedWorkflow}）。 */
  bodyLineOffset: number;
}

export type SavedWorkflowResolveFailure =
  | { ok: false; reason: "invalid_name"; detail: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "parse_error"; path: string; detail: string }
  | { ok: false; reason: "read_error"; path: string; detail: string };

export type SavedWorkflowResolveResult =
  | ({ ok: true } & ResolvedSavedWorkflow)
  | SavedWorkflowResolveFailure;

export interface SavedWorkflowListResult {
  entries: SavedWorkflowEntry[];
  invalid: SavedWorkflowInvalidEntry[];
}

/** 名字 → 文件名。名字已经过 {@link isValidSavedWorkflowName}，此处不再兜底。 */
export function savedWorkflowFileName(name: string): string {
  return `${name}${SAVED_WORKFLOW_FILE_EXTENSION}`;
}

/**
 * 名字在给定根下的落点。写侧与读侧共用它——两处各自拼路径正是「保存成功但读不出来」的
 * 经典成因。
 */
export function savedWorkflowPath(root: SavedWorkflowRoot, name: string): string {
  return join(root.dir, savedWorkflowFileName(name));
}

/**
 * 按名字解析一个保存的 workflow。
 *
 * 名字先过合法性检查再拼路径：这条顺序是路径穿越的防线本身，不是输入卫生的小节——
 * `../../.ssh/id_rsa` 拼进 join 之后就是一个能读的绝对路径了。
 *
 * 给了 `scope`：只查那一根（中枢与 `saved.scope` 的定向查找）；不给：两根按序 first-wins。
 */
export function resolveSavedWorkflow(options: {
  cwd: string;
  name: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): SavedWorkflowResolveResult {
  const { cwd, name, scope, homeDir } = options;
  if (!isValidSavedWorkflowName(name)) {
    return {
      ok: false,
      reason: "invalid_name",
      detail: `workflow names may only contain letters, digits, '.', '-' and '_', and must be 1-${SAVED_WORKFLOW_MAX_NAME_CHARS} characters`,
    };
  }

  const roots =
    scope === undefined
      ? savedWorkflowRoots(cwd, { homeDir })
      : [savedWorkflowRoot(cwd, scope, { homeDir })];

  for (const root of roots) {
    const path = savedWorkflowPath(root, name);
    let source: string;
    try {
      source = readFileSync(path, "utf8");
    } catch (error) {
      // 这一根没有它，看下一根。其余读错（权限、是目录）是**这个**文件的问题，说出来而不是
      // 装作没找到——"not found" 会把用户送去检查一个其实存在的名字。
      if (isNotFound(error)) continue;
      return { ok: false, reason: "read_error", path, detail: describeError(error) };
    }

    const parsed = parseSavedWorkflow(source);
    if (!parsed.ok) {
      return { ok: false, reason: "parse_error", path, detail: parsed.detail };
    }
    return {
      ok: true,
      name,
      path,
      scope: root.scope,
      meta: parsed.meta,
      script: parsed.script,
      source,
      bodyLineOffset: parsed.bodyLineOffset,
    };
  }

  return { ok: false, reason: "not_found" };
}

/**
 * 枚举保存定义（深度 1 的平铺扫描，不递归子目录）。
 *
 * 坏文件进 `invalid` 而不是抛错：这些文件是用户手改的，一个错字不该让整份清单消失。
 *
 * 不给 `scope`：两根按序，同名定义 first-wins，被遮蔽的那份**不**出现在列表里——列表要说的
 * 是"调用这个名字会跑到什么"，而不是"磁盘上有几份"。给了 `scope`：只扫那一根，**不**做遮蔽
 * （中枢的全局组要看到被项目档遮蔽的那一份）。
 */
export function listSavedWorkflows(options: {
  cwd: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): SavedWorkflowListResult {
  const entries: SavedWorkflowEntry[] = [];
  const invalid: SavedWorkflowInvalidEntry[] = [];
  const claimed = new Set<string>();

  const roots =
    options.scope === undefined
      ? savedWorkflowRoots(options.cwd, { homeDir: options.homeDir })
      : [savedWorkflowRoot(options.cwd, options.scope, { homeDir: options.homeDir })];

  for (const root of roots) {
    let fileNames: string[];
    try {
      fileNames = readdirSync(root.dir);
    } catch (error) {
      // 目录不存在是常态（大多数项目没保存过 workflow），不是错误。
      if (isNotFound(error)) continue;
      invalid.push({ path: root.dir, reason: describeError(error) });
      continue;
    }

    // readdir 的顺序随文件系统而定；排序让列表在两台机器上一致。
    for (const fileName of [...fileNames].sort()) {
      if (!fileName.endsWith(SAVED_WORKFLOW_FILE_EXTENSION)) continue;
      const name = fileName.slice(0, -SAVED_WORKFLOW_FILE_EXTENSION.length);
      const path = join(root.dir, fileName);

      if (!isValidSavedWorkflowName(name)) {
        invalid.push({ path, reason: "file name is not a usable workflow name" });
        continue;
      }
      // 已被更高优先级的作用域认领：这一份跑不到，也就不列。
      if (claimed.has(name)) continue;

      let source: string;
      try {
        source = readFileSync(path, "utf8");
      } catch (error) {
        // 目录项存在却读不出来（子目录、权限）——不是"没有"，是"坏了"。
        invalid.push({ path, reason: describeError(error) });
        continue;
      }

      const parsed = parseSavedWorkflow(source);
      if (!parsed.ok) {
        invalid.push({ path, reason: `${parsed.reason}: ${parsed.detail}` });
        continue;
      }

      claimed.add(name);
      entries.push({
        name,
        description: parsed.meta.description,
        ...(parsed.meta.whenToUse === undefined ? {} : { whenToUse: parsed.meta.whenToUse }),
        ...(parsed.meta.args === undefined ? {} : { args: parsed.meta.args }),
        scope: root.scope,
        path,
      });
    }
  }

  return { entries, invalid };
}

/**
 * 写入一个保存定义，返回落点与「这次是不是覆盖」。
 *
 * `scope` 决定落到哪一根（缺省 `project`，保持既有语义）。作用域是**写侧的选择**了——模型
 * 在 SaveWorkflow 里必填它。
 */
export function saveSavedWorkflow(options: {
  cwd: string;
  name: string;
  meta: SavedWorkflowMeta;
  script: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): { path: string; scope: SavedWorkflowScope; overwritten: boolean } {
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", {
    homeDir: options.homeDir,
  });
  const path = savedWorkflowPath(root, options.name);
  mkdirSync(root.dir, { recursive: true });
  const overwritten = fileExists(path);
  writeFileSync(path, serializeSavedWorkflow(options.meta, options.script), "utf8");
  return { path, scope: root.scope, overwritten };
}

/** 目标是否已存在（确认窗要把"覆盖"与"新建"说成两件事）。缺省查项目档。 */
export function savedWorkflowExists(options: {
  cwd: string;
  name: string;
  scope?: SavedWorkflowScope;
  homeDir?: string;
}): boolean {
  if (!isValidSavedWorkflowName(options.name)) return false;
  const root = savedWorkflowRoot(options.cwd, options.scope ?? "project", {
    homeDir: options.homeDir,
  });
  return fileExists(savedWorkflowPath(root, options.name));
}

/**
 * 保存到 `scope` 时，另一档是否已有同名定义（遮蔽事实，供确认窗展示）。
 *
 * 保存项目档而全局档已有同名 → `hides_global`（本项目里项目档赢）；保存全局档而项目档已有
 * 同名 → `hidden_by_project`（本项目里它跑不到）。两档都没有 → `undefined`。
 */
export function findSavedWorkflowShadowing(options: {
  cwd: string;
  name: string;
  scope: SavedWorkflowScope;
  homeDir?: string;
}): SavedWorkflowShadowing | undefined {
  if (!isValidSavedWorkflowName(options.name)) return undefined;
  const otherScope: SavedWorkflowScope = options.scope === "project" ? "global" : "project";
  const otherRoot = savedWorkflowRoot(options.cwd, otherScope, { homeDir: options.homeDir });
  if (!fileExists(savedWorkflowPath(otherRoot, options.name))) return undefined;
  return options.scope === "project" ? "hides_global" : "hidden_by_project";
}

/** 把全局档搬回项目档的结果。 */
export type SavedWorkflowMoveResult =
  | { ok: true; from: string; to: string }
  | { ok: false; reason: "invalid_name"; detail: string }
  | { ok: false; reason: "not_found" }
  | { ok: false; reason: "target_exists"; path: string }
  | { ok: false; reason: "read_error" | "write_error"; path: string; detail: string };

/**
 * 把全局根的 `name` 搬到 `cwd` 的项目根（**只有这一向**）。
 *
 * 反向（项目→全局）不是搬文件：项目档大多引用本仓库的路径 / 命令 / 约定，逐字节搬过去就是
 * 一个在别的项目里必然跑坏的全局定义。那一向是模型的概括（「提升为全局」：GUI 在该项目开
 * 新会话发概括提示，模型经 SaveWorkflow 另存全局档）。全局→项目是特化，一份全局定义落到某个项目里照跑，所以仍是搬文件。
 *
 * **逐字节搬**（不 parse、不 reserialize）：frontmatter 不存 scope，所以移动就是移文件。
 * `renameSync` 优先，跨设备（EXDEV）回落到读→写→删。目标已存在即拒绝（不覆盖：覆盖是
 * SaveWorkflow 经确认窗才有的动作）。名字先过合法性检查——路径穿越的防线本身。
 */
export function moveSavedWorkflow(options: {
  cwd: string;
  name: string;
  homeDir?: string;
}): SavedWorkflowMoveResult {
  const { cwd, name, homeDir } = options;
  if (!isValidSavedWorkflowName(name)) {
    return {
      ok: false,
      reason: "invalid_name",
      detail: `workflow names may only contain letters, digits, '.', '-' and '_', and must be 1-${SAVED_WORKFLOW_MAX_NAME_CHARS} characters`,
    };
  }

  const fromRoot = savedWorkflowRoot(cwd, "global", { homeDir });
  const toRoot = savedWorkflowRoot(cwd, "project", { homeDir });
  const fromPath = savedWorkflowPath(fromRoot, name);
  const toPath = savedWorkflowPath(toRoot, name);

  if (!fileExists(fromPath)) return { ok: false, reason: "not_found" };
  if (fileExists(toPath)) return { ok: false, reason: "target_exists", path: toPath };

  try {
    mkdirSync(toRoot.dir, { recursive: true });
  } catch (error) {
    return { ok: false, reason: "write_error", path: toPath, detail: describeError(error) };
  }

  try {
    renameSync(fromPath, toPath);
    return { ok: true, from: fromPath, to: toPath };
  } catch (error) {
    // 跨设备（例如家目录与项目分处不同挂载点）时 rename 报 EXDEV：读→写→删的回落搬运，
    // 读写各自归错，好让上层把"源读不出来"和"目标写不进去"说成两件事。
    if ((error as NodeJS.ErrnoException | undefined)?.code !== "EXDEV") {
      return { ok: false, reason: "write_error", path: toPath, detail: describeError(error) };
    }
  }

  let bytes: Buffer;
  try {
    bytes = readFileSync(fromPath);
  } catch (error) {
    return { ok: false, reason: "read_error", path: fromPath, detail: describeError(error) };
  }
  try {
    writeFileSync(toPath, bytes);
    unlinkSync(fromPath);
  } catch (error) {
    return { ok: false, reason: "write_error", path: toPath, detail: describeError(error) };
  }
  return { ok: true, from: fromPath, to: toPath };
}

function fileExists(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isNotFound(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  // ENOTDIR：路径中间有一段是文件（`.zcode/workflows` 被人建成了文件）。对查找而言与
  // "目录不存在"是同一件事。
  return code === "ENOENT" || code === "ENOTDIR";
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
