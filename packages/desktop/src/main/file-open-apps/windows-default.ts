import { win32 } from "node:path";
import type { NativeFileApplication } from "./contract.js";

export interface WindowsDefaultAssociation {
  progId?: string | null;
  appId?: string | null;
  executable?: string | null;
}
export interface WindowsFileApplication extends NativeFileApplication {
  progId?: string | null;
  appId?: string | null;
}

const identifier = (value: unknown): string =>
  typeof value === "string" ? value.trim().toLowerCase() : "";
const executable = (value: unknown): string =>
  typeof value === "string" && win32.isAbsolute(value) ? win32.normalize(value).toLowerCase() : "";

/** 只用 Shell 的有效默认身份，不把原始 UserChoice 或展示名当成已生效默认。 */
export function applyWindowsDefaultAssociation(
  applications: readonly WindowsFileApplication[],
  association?: WindowsDefaultAssociation | null,
): NativeFileApplication[] {
  let candidates = [...applications];
  let selectedKey = "";
  if (association) {
    const comparisons = [
      {
        expected: identifier(association.progId),
        actual: (app: WindowsFileApplication) => identifier(app.progId),
      },
      {
        expected: identifier(association.appId),
        actual: (app: WindowsFileApplication) => identifier(app.appId),
      },
      {
        expected: executable(association.executable),
        actual: (app: WindowsFileApplication) => executable(app.key),
      },
    ];
    for (const comparison of comparisons) {
      if (!comparison.expected) continue;
      const matching = candidates.filter((app) => comparison.actual(app) === comparison.expected);
      if (!matching.length) continue;
      candidates = matching;
      const keys = new Set(matching.map((app) => executable(app.key) || identifier(app.key)));
      if (keys.size === 1) {
        selectedKey = [...keys][0]!;
        break;
      }
    }
  }
  // SVG 的 Edge 等处理器没有 exe 路径，过去只比 exe 会漏标；ProgID/AppID 可识别它。
  // 同时丢弃输入旧标记；无法唯一确认时宁可不标默认，也不能退到同名应用或残留 UserChoice。
  return applications.map((app) => ({
    ...app,
    isDefault: Boolean(selectedKey && (executable(app.key) || identifier(app.key)) === selectedKey),
  }));
}
