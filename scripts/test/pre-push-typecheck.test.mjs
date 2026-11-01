import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

async function run(command, args, cwd, env) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(command, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.once("error", reject);
    child.once("close", (code) => resolveResult({ code, output }));
  });
}

test("已提交 push 经真实 hook 执行 tsc；失败后不运行 affected UT", async () => {
  const root = await mkdtemp(join(tmpdir(), "pre-push-typecheck-"));
  const work = join(root, "work");
  const bare = join(root, "remote.git");
  const bin = join(root, "bin");
  const trace = join(root, "gates.log");
  try {
    await mkdir(work);
    await mkdir(bin);
    const packageJson = JSON.parse(await readFile(join(repo, "package.json"), "utf8"));
    const hook = await readFile(join(repo, ".husky/pre-push"), "utf8");
    // 修复依据：只有 Git 实际触发 hook，才能证明 committed push 也经过新增 tsc 门禁；
    // 其他门禁留可观测桩隔离测试范围，不修改真实安装或访问网络 remote。
    const shim = join(bin, "pnpm");
    await writeFile(
      shim,
      `#!/usr/bin/env node\n` +
        `const { spawnSync } = require("node:child_process");\n` +
        `const { appendFileSync } = require("node:fs");\n` +
        `const step = process.argv[3];\n` +
        `appendFileSync(process.env.GATE_TRACE, step + "\\n");\n` +
        `if (step === "verify:pre-push") {\n` +
        ` const result = spawnSync("sh", ["-c", ${JSON.stringify(packageJson.scripts["verify:pre-push"])}], { stdio: "inherit" });\n` +
        ` process.exit(result.status ?? 1);\n` +
        `}\n` +
        `if (step === "typecheck") {\n` +
        ` const result = spawnSync(process.execPath, [${JSON.stringify(join(repo, "node_modules/typescript/bin/tsc"))}, "--noEmit", "--skipLibCheck", "index.ts"], { stdio: "inherit" });\n` +
        ` process.exit(result.status ?? 1);\n` +
        `}\n`,
    );
    await chmod(shim, 0o755);
    const env = {
      ...Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith("GIT_"))),
      PATH: `${bin}:${process.env.PATH}`,
      GATE_TRACE: trace,
      HUSKY: "0",
    };
    async function git(...args) {
      const result = await run("git", args, work, env);
      assert.equal(result.code, 0, result.output);
      return result.output.trim();
    }
    await git("init", "--initial-branch=main");
    await git("config", "user.name", "Gate Fixture");
    await git("config", "user.email", "gate-fixture@example.invalid");
    await git("config", "core.hooksPath", ".hooks");
    await git("init", "--bare", bare);
    await git("remote", "add", "origin", bare);
    await mkdir(join(work, ".hooks"));
    await writeFile(join(work, ".hooks/pre-push"), hook);
    await chmod(join(work, ".hooks/pre-push"), 0o755);
    await writeFile(join(work, "index.ts"), "export const checked: number = 1;\n");
    await git("add", ".");
    await git("commit", "-m", "passing committed fixture");
    await git("push", "origin", "HEAD:refs/heads/main");
    const good = await git("rev-parse", "HEAD");
    assert.deepEqual((await readFile(trace, "utf8")).trim().split("\n"), [
      "verify:pre-push",
      "lint",
      "architecture:check",
      "db:schema:check",
      "typecheck",
      "test:unit:affected",
    ]);

    await writeFile(trace, "");
    await writeFile(join(work, "index.ts"), 'export const checked: number = "committed error";\n');
    await git("add", "index.ts");
    await git("commit", "-m", "failing committed fixture");
    assert.equal(await git("status", "--porcelain"), "");
    const failed = await run("git", ["push", "origin", "HEAD:refs/heads/main"], work, env);
    assert.notEqual(failed.code, 0, failed.output);
    assert.match(failed.output, /TS2322/);
    const steps = (await readFile(trace, "utf8")).trim().split("\n");
    assert.equal(steps.at(-1), "typecheck");
    assert.ok(!steps.includes("test:unit:affected"));
    assert.equal(await git("--git-dir", bare, "rev-parse", "refs/heads/main"), good);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
