# Browser-safe 根入口守卫

## 范围与所有者

`@zcode/services` 和 `@zcode/shared` 的根入口是浏览器侧公共值入口，不能传递导入 Node 能力。Node 实现仍由独立 node 入口或内部实现模块拥有；本修正不新增模块、描述符、频道或架构依赖。

OrcaRouter 描述符唯一的频道来源是 `ServiceChannels.OrcaRouter`。客户端读取同一常量，服务端描述符仍在 `orcarouter/service.ts` 创建，频道名和调用行为不变。根入口仅导出接口类型，不能为拿频道名重新引入 Node 实现。

## 静态守卫合同

- 从两个根入口分别遍历运行时导入闭包，包括私有静态 import、side-effect import、re-export、字面量动态 import 和 require，不能只检查公开 re-export。
- 使用 TypeScript AST 辨识语句，忽略注释和字符串中的伪导入；整条 `import type`、`export type` 与类型查询不构成运行时边。当前 `verbatimModuleSyntax: true` 会将纯 inline type specifier 的语句保留为 `import {}` / `export {} from`，仍有模块副作用，必须继续遍历。
- `.js`/`.mjs` 按 NodeNext 规则解析对应 TypeScript 源文件；同一文件只访问一次，循环导入不能使遍历失控。
- 相对路径、包内 `#` imports 和 workspace 包别名必须解析并继续遍历；无法解析的内部说明符使守卫失败，不能静默忽略。第三方依赖的条件导出及传递依赖不在本源码守卫证明范围内，仍需浏览器构建验证。
- 禁止 `node:*`、裸 Node 内置说明符（包括 `fs/promises` 等子路径）、Electron 和原生 `.node` 模块；动态导入在函数内也保守计入，不靠 tree-shaking 证明安全。非字面量动态 import/require 无法静态证明，也应失败。
- 守卫只判断可达性，不声称任意可达 Node import 必然已经造成生产挂载失败；是否发生运行时故障仍依赖实际打包、externalize 和运行环境。

## 验收

除两个真实根入口通过外，夹具必须证明：传递私有导入、动态导入、require、包内/跨 workspace 别名、两种引号和裸/带前缀 Node 说明符确实失败；编译擦除的 type-only 形式、注释和字符串中的伪导入通过，保留副作用的 inline type 语句仍遍历；循环可终止；缺失内部模块失败。另有客户端与服务端描述符测试分别断言共享频道常量完全一致。原始 main 的 OrcaRouter 值导出必须能复现 `connect.ts → node:crypto`，不能让守卫只会对自身通过。
