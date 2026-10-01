import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

/**
 * 在 ESM 与 esbuild CJS bundle 两种环境里都能拿到的 require。
 *
 * services 会被打包进 zcode.cjs（CJS）：esbuild 对 CJS 输出会把 import.meta.url
 * 置为 undefined，直接 createRequire(import.meta.url) 会在运行时抛
 * ERR_INVALID_ARG_VALUE（本地数据库启动曾因此失败）。回退用 __filename 构造
 * file URL；ESM（host tsup / tsx 测试）下 import.meta.url 仍是字符串，原样使用。
 */
export function createNodeRequire(): NodeRequire {
  return createRequire(
    typeof import.meta.url === "string" ? import.meta.url : pathToFileURL(__filename).href,
  );
}
