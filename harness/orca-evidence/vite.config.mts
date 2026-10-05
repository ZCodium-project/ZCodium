import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const REPO_ROOT = resolve(HERE, "../..");
const UI_SRC = resolve(REPO_ROOT, "packages/ui/src");
const PORT = Number(process.env.ORCA_EVIDENCE_PORT ?? 5199);

export default defineConfig({
  // 根指向 harness 目录：index.html 与 main.tsx 都在这里。
  root: HERE,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: [
      // 与 packages/web/vite.config.ts 一致：把 @ 别名补到 UI 包源码。
      { find: /^@\//, replacement: `${UI_SRC}/` },
      // 工作区包只有 packages/*/node_modules 里的相对软链，harness 自己不在
      // workspace 依赖图里，因此需要显式指向每个包的公开源码入口。
      // styles.css 在 @zcode/ui 之前匹配，避免被包入口前缀替换。
      {
        find: /^@zcode\/ui\/styles\.css$/,
        replacement: resolve(UI_SRC, "styles.css"),
      },
      { find: /^@zcode\/ui$/, replacement: resolve(UI_SRC, "index.ts") },
      {
        find: /^@zcode\/shared$/,
        replacement: resolve(REPO_ROOT, "packages/shared/src/index.ts"),
      },
      {
        find: /^@zcode\/services$/,
        replacement: resolve(REPO_ROOT, "packages/services/src/index.ts"),
      },
      {
        find: /^@zcode\/model-option-map$/,
        replacement: resolve(REPO_ROOT, "packages/model-option-map/src/index.ts"),
      },
      {
        find: /^@zcode\/provider$/,
        replacement: resolve(REPO_ROOT, "packages/provider/src/index.ts"),
      },
    ],
  },
  optimizeDeps: {
    include: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
  server: {
    port: PORT,
    strictPort: true,
    host: "127.0.0.1",
  },
  // 浏览器用 import.meta.env；共享代码保留的 __ZCODE_* 编译期常量在这里补上默认值。
  define: {
    __ZCODE_ENV__: JSON.stringify("test"),
    __ZCODE_VERSION__: JSON.stringify("0.0.0-evidence"),
    __ZCODE_COMMIT__: JSON.stringify("evidence"),
    __ZCODE_ENDPOINT_ENV__: JSON.stringify({}),
  },
});
