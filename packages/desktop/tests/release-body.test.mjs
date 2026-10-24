import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { parse } from "yaml";

const repoRoot = resolve(import.meta.dirname, "../../..");
const execFileAsync = promisify(execFile);
const workflow = parse(await readFile(join(repoRoot, ".github/workflows/release.yml"), "utf8"));
const step = workflow.jobs.release.steps.find(
  (entry) => entry.name === "Create tag and draft release",
);
// 跳过真实 tag/push，只执行其后的原始说明生成与 draft 命令，避免复制实现造成假回归。
const tagPush = 'git push origin "$TAG"\n';
assert.ok(step.run.includes(tagPush));
const body = step.run.slice(step.run.indexOf(tagPush) + tagPush.length);

async function generate(t, { version = "9.8.7", files = {}, notice = "", base = "v9.8.6" } = {}) {
  const parent = join(tmpdir(), "opencode");
  await mkdir(parent, { recursive: true });
  const directory = await mkdtemp(join(parent, "release-body-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const bin = join(directory, "bin");
  await mkdir(bin);
  for (const [name, content] of Object.entries(files)) {
    await mkdir(join(directory, "docs/releases"), { recursive: true });
    await writeFile(join(directory, "docs/releases", name), content);
  }
  await writeFile(
    join(bin, "git"),
    '#!/bin/bash\nprintf "%s\\n" git >> "$CALLS"\nprintf "%s\\n" "$BASE_TAG"\n',
    { mode: 0o755 },
  );
  await writeFile(
    join(bin, "node"),
    '#!/bin/bash\nprintf "%s\\n" node >> "$CALLS"\nprintf "%s\\n" "- synthetic commit / 合成提交"\n',
    { mode: 0o755 },
  );
  await writeFile(join(bin, "gh"), '#!/bin/bash\nprintf "%s\\0" "$@" > "$CAPTURE_ARGS"\n', {
    mode: 0o755,
  });
  const calls = join(directory, "calls.txt");
  const args = join(directory, "args.txt");
  await writeFile(calls, "");
  // 只适配临时路径与 BSD sed 的空备份参数；选择分支、替换表达式及发布参数仍执行原始正文。
  const isolatedBody = body.replaceAll("/tmp/", `${directory}/`);
  const runnableBody =
    process.platform === "darwin"
      ? isolatedBody.replaceAll('sed -i "', 'sed -i "" "')
      : isolatedBody;
  await execFileAsync("bash", ["-euo", "pipefail", "-c", runnableBody], {
    cwd: directory,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      LC_ALL: "C", // macOS Bash 3 不应把紧随变量的中文标点当成变量名的一部分。
      TAG: `v${version}`,
      NOTICE: notice,
      PRERELEASE: String(version.includes("-")),
      GITHUB_REPOSITORY: "example/release-fixture",
      BASE_TAG: base,
      CALLS: calls,
      CAPTURE_ARGS: args,
    },
  });
  const capturedArgs = (await readFile(args, "utf8")).split("\0").filter(Boolean);
  assert.deepEqual(capturedArgs.slice(6, 8), ["--notes-file", join(directory, "release-notes.md")]);
  return {
    notes: await readFile(join(directory, "release-notes.md"), "utf8"),
    calls: await readFile(calls, "utf8"),
    args: capturedArgs,
  };
}

test("精确版本文件是唯一正文，替换版本占位符但不混入自动摘要或通用模板", async (t) => {
  const result = await generate(t, {
    files: { "v9.8.7.md": "# ZCodium <VERSION>\n\n仅此版本说明。\n" },
  });
  assert.equal(result.notes, "# ZCodium 9.8.7\n\n仅此版本说明。\n");
  assert.equal(result.calls, "", "人工正文不应查询基线或渲染 commit 摘要");
  assert.deepEqual(result.args.slice(0, 6), [
    "release",
    "create",
    "v9.8.7",
    "--draft",
    "--title",
    "v9.8.7",
  ]);
  assert.ok(!result.args.includes("--prerelease"));
});

test("完整 audit 文件精确命中，NOTICE 最后原样置顶且保持预发布 draft", async (t) => {
  const version = "9.8.7-audit.20261024.2";
  const content = `# ZCodium ${version}\n\n独立审计版说明。\n`;
  const notice = "> 测试版\n> 不执行 $(printf unsafe) 或 `printf unsafe`；$HOME 原样保留。";
  const result = await generate(t, {
    version,
    files: { "v9.8.7.md": "错误的基础版本说明", [`v${version}.md`]: content },
    notice,
  });
  assert.equal(result.notes, `${notice}\n\n${content}`);
  assert.equal(result.calls, "");
  assert.ok(result.args.includes("--draft"));
  assert.ok(result.args.includes("--prerelease"));
});

test("没有版本文件时保留 commit 差异，但移除账号和购买可开关恢复的失实说明", async (t) => {
  const result = await generate(t);
  assert.match(result.notes, /Changelog \(vs v9\.8\.6\)/);
  assert.match(result.notes, /synthetic commit \/ 合成提交/);
  assert.match(result.notes, /compare\/v9\.8\.6\.\.\.v9\.8\.7/);
  assert.match(result.notes, /ZCodium 9\.8\.7/);
  assert.match(result.notes, /官方账号、购买和分享入口已移除/);
  assert.match(result.notes, /仅插件市场与客户端远端配置/);
  assert.doesNotMatch(result.notes, /coding-plan switch|套餐与额度|浏览器授权登录入口/);
  assert.equal(result.calls, "git\nnode\n");
});

test("没有完整 audit 文件时不借用基础版本，无正式基线不伪造差异且 NOTICE 仍置顶", async (t) => {
  const notice = "> 尚未验证的预发布\n> 请勿用于生产。";
  const result = await generate(t, {
    version: "9.8.7-audit.20261024.3",
    files: { "v9.8.7.md": "不应借用的基础版本正文" },
    base: "",
    notice,
  });
  assert.ok(result.notes.startsWith(`${notice}\n\n# ZCodium 9.8.7-audit.20261024.3`));
  assert.doesNotMatch(result.notes, /Changelog \(vs|不应借用的基础版本正文|synthetic commit/);
  assert.match(result.notes, /官方账号、购买和分享入口已移除/);
  assert.equal(result.calls, "git\n");
  assert.ok(result.args.includes("--draft"));
});

test("正式 v1.17.0 文件完整进入 draft 正文，不附加旧模板或 commit 摘要", async (t) => {
  const content = await readFile(join(repoRoot, "docs/releases/v1.17.0.md"), "utf8");
  const notice = "> 发布前的显式警示";
  const result = await generate(t, {
    version: "1.17.0",
    files: { "v1.17.0.md": content },
    notice,
  });
  assert.equal(result.notes, `${notice}\n\n${content}`);
  assert.equal(result.calls, "");
  assert.match(result.notes, /84 文件、622 项通过，不是全仓 UT/);
  assert.match(result.notes, /273 通过、41 失败/);
  assert.match(result.notes, /目录包成功不等于 DMG 已验收/);
  assert.ok(result.args.includes("--draft"));
  assert.ok(!result.args.includes("--prerelease"));
});
