// 多生态插件兼容测试：Codex 根 hooks.json 探测与 Claude 标准位置的优先级。
// 运行：node_modules/.bin/tsx --test apps/zcode-cli/tests/plugin-hook-sources-compat.test.mjs
// （tsx 负责把源码内 `./x.js` 形式的相对导入映射到 `.ts` 源文件。）
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, test } from 'node:test';
import { listPluginHookSources } from '../packages/adapters/src/plugins/hook-sources.ts';


/** @type {string[]} */
const fixtureRoots = [];
after(() => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

/**
 * @param {Record<string, string | Record<string, unknown>>} files
 * @returns {string}
 */
function createPluginRoot(files) {
  const rootPath = mkdtempSync(join(tmpdir(), 'zcode-plugin-ecosystem-'));
  fixtureRoots.push(rootPath);
  for (const [relativePath, content] of Object.entries(files)) {
    const targetPath = join(rootPath, ...relativePath.split('/'));
    mkdirSync(dirname(targetPath), { recursive: true });
    writeFileSync(
      targetPath,
      typeof content === 'string' ? content : `${JSON.stringify(content, null, 2)}\n`,
    );
  }
  return rootPath;
}

/**
 * @param {string} rootPath
 * @param {string} manifestPath
 * @param {Record<string, unknown>} manifest
 */
function loadedFixture(rootPath, manifestPath, manifest) {
  return {
    id: 'fixture@fixture-market',
    manifest: { name: 'fixture', ...manifest },
    manifestPath: join(rootPath, ...manifestPath.split('/')),
    marketplace: 'fixture-market',
    rootPath,
    source: 'cache',
  };
}

const sessionStartHooks = {
  hooks: {
    SessionStart: [{ matcher: 'startup', hooks: [{ type: 'command', command: 'echo start' }] }],
  },
};

test('Codex 布局：标准位置缺席时发现插件根 hooks.json', () => {
  const rootPath = createPluginRoot({
    '.codex-plugin/plugin.json': { name: 'fixture', version: '0.0.1' },
    'hooks.json': sessionStartHooks,
  });
  const diagnostics = [];
  const sources = listPluginHookSources({
    diagnostics,
    loaded: loadedFixture(rootPath, '.codex-plugin/plugin.json', { version: '0.0.1' }),
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourcePath, join(rootPath, 'hooks.json'));
  assert.equal(sources[0].wrapper, true);
  assert.deepEqual(diagnostics, []);
});

test('双布局：hooks/hooks.json 存在时以标准位置为准，根 hooks.json 不参与', () => {
  const rootPath = createPluginRoot({
    '.claude-plugin/plugin.json': { name: 'fixture', version: '0.0.1' },
    'hooks/hooks.json': sessionStartHooks,
    'hooks.json': sessionStartHooks,
  });
  const sources = listPluginHookSources({
    diagnostics: [],
    loaded: loadedFixture(rootPath, '.claude-plugin/plugin.json', { version: '0.0.1' }),
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourcePath, join(rootPath, 'hooks', 'hooks.json'));
});

test('回归：仅 hooks/hooks.json 的 Claude 布局行为不变', () => {
  const rootPath = createPluginRoot({
    '.claude-plugin/plugin.json': { name: 'fixture', version: '0.0.1' },
    'hooks/hooks.json': sessionStartHooks,
  });
  const sources = listPluginHookSources({
    diagnostics: [],
    loaded: loadedFixture(rootPath, '.claude-plugin/plugin.json', { version: '0.0.1' }),
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourcePath, join(rootPath, 'hooks', 'hooks.json'));
});

test('manifest.hooks 声明根 hooks.json 时与自动发现去重', () => {
  const rootPath = createPluginRoot({
    '.codex-plugin/plugin.json': {
      name: 'fixture',
      version: '0.0.1',
      hooks: ['hooks.json'],
    },
    'hooks.json': sessionStartHooks,
  });
  const diagnostics = [];
  const sources = listPluginHookSources({
    diagnostics,
    loaded: loadedFixture(rootPath, '.codex-plugin/plugin.json', {
      version: '0.0.1',
      hooks: ['hooks.json'],
    }),
  });
  assert.equal(sources.length, 1);
  assert.equal(sources[0].sourcePath, join(rootPath, 'hooks.json'));
  assert.equal(
    diagnostics.some((item) => item.code === 'plugin_hook_invalid' && /Duplicate/.test(item.message)),
    true,
  );
});

