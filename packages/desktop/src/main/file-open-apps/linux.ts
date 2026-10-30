import { access, readFile, readdir } from "node:fs/promises";
import { constants } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join } from "node:path";
import type { NativeFileApplication } from "./contract.js";

export type NativeRun = (
  command: string,
  args: string[],
  env?: NodeJS.ProcessEnv,
  detached?: boolean,
) => Promise<string>;

export function parseDesktopEntry(content: string): Record<string, string> {
  const fields: Record<string, string> = {};
  let inEntry = false;
  for (const line of content.split(/\r?\n/)) {
    if (line.startsWith("[")) {
      inEntry = line.trim() === "[Desktop Entry]";
      continue;
    }
    if (!inEntry || line.startsWith("#")) continue;
    const match = /^([^=]+)=(.*)$/.exec(line);
    if (match) fields[match[1]!.trim()] = match[2]!.trim();
  }
  return fields;
}

async function canExecute(executable: string): Promise<boolean> {
  const candidates = isAbsolute(executable)
    ? [executable]
    : (process.env.PATH ?? "")
        .split(":")
        .filter(Boolean)
        .map((root) => join(root, executable));
  for (const path of candidates) {
    try {
      await access(path, constants.X_OK);
      return true;
    } catch {
      /* 缺失可执行文件不是有效安装。 */
    }
  }
  return false;
}

/** XDG ID 使用相对路径中的斜线换成连字符；用户目录优先覆盖系统目录。 */
async function desktopFiles(roots: string[]): Promise<Map<string, string>> {
  const files = new Map<string, string>();
  async function walk(root: string, relative = "", depth = 0): Promise<void> {
    if (depth > 8 || files.size > 8192) return;
    const entries = await readdir(join(root, relative), { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const child = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(root, child, depth + 1);
      else if (entry.name.endsWith(".desktop")) {
        const id = child.replaceAll("/", "-");
        if (!files.has(id)) files.set(id, join(root, child));
      }
    }
  }
  for (const root of roots) await walk(root);
  return files;
}

export async function queryLinuxApplications(
  path: string,
  run: NativeRun,
  roots = [
    process.env.XDG_DATA_HOME || join(homedir(), ".local/share"),
    ...(process.env.XDG_DATA_DIRS || "/usr/local/share:/usr/share").split(":"),
  ]
    .filter(isAbsolute)
    .map((root) => join(root, "applications")),
): Promise<NativeFileApplication[]> {
  const env = { LC_ALL: "C", LANG: "C" };
  const mime = (await run("xdg-mime", ["query", "filetype", path], env)).trim();
  if (!/^[\w.+-]+\/[\w.+-]+$/.test(mime)) return [];
  // GIO 负责合并 mimeapps.list 与 desktop entry，不能只扫扩展名或自行猜测默认应用。
  let association = "";
  let defaultId: string | undefined;
  let defaultOnly = false;
  try {
    association = await run("gio", ["mime", mime], env);
    defaultId = /^Default application for .+:\s*(\S+\.desktop)\s*$/m.exec(association)?.[1];
  } catch {
    // 精简桌面可能只有 xdg-utils；不要求用户安装 GIO，也不显示无法启动的其他应用。
    defaultId = (await run("xdg-mime", ["query", "default", mime], env)).trim();
    if (!defaultId.endsWith(".desktop")) return [];
    await run("xdg-open", ["--version"], env);
    defaultOnly = true;
  }
  const ids = [
    ...new Set([...association.matchAll(/^\s+(\S+\.desktop)\s*$/gm)].map((match) => match[1]!)),
  ];
  if (defaultId && !ids.includes(defaultId)) ids.unshift(defaultId);
  const files = await desktopFiles(roots);
  const result: NativeFileApplication[] = [];
  for (const id of ids) {
    const desktopPath = files.get(id);
    if (!desktopPath) continue;
    const fields = parseDesktopEntry(await readFile(desktopPath, "utf8").catch(() => ""));
    if (fields.Type !== "Application" || fields.Hidden === "true" || !fields.Name) continue;
    if (fields.TryExec && !(await canExecute(fields.TryExec))) continue;
    if (!fields.Exec && fields.DBusActivatable !== "true") continue;
    result.push({
      key: desktopPath,
      identity: `linux-desktop:${id}`,
      name: fields.Name.replace(/\\s/g, " "),
      isDefault: id === defaultId,
      iconPath: isAbsolute(fields.Icon ?? "") ? fields.Icon : undefined,
      ...(defaultOnly ? { launchKind: "system-default" as const } : {}),
    });
  }
  return result;
}
