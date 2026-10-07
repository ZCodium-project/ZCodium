// zip 解压兼容测试：不可压缩大 deflate 条目的内存解压回归（背景见 zip-source.ts 修复注释）。
// 运行：node_modules/.bin/tsx --test apps/zcode-cli/tests/plugin-zip-extract.test.mjs
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { deflateRawSync } from 'node:zlib';
import { resolveHttpZipSource } from '../packages/adapters/src/plugins/zip-source.ts';

/**
 * 构造只含一个 deflate 条目的最小 zip。
 * CRC 字段置 0：读取方不校验 CRC，内容一致性由测试内哈希断言守护。
 */
function buildDeflatedSingleFileZip(name, data) {
  const compressed = deflateRawSync(data);
  const nameBytes = Buffer.from(name, 'utf8');
  const localHeader = Buffer.alloc(30);
  localHeader.writeUInt32LE(0x04034b50, 0);
  localHeader.writeUInt16LE(20, 4);
  localHeader.writeUInt16LE(0, 6);
  localHeader.writeUInt16LE(8, 8);
  localHeader.writeUInt32LE(0, 14);
  localHeader.writeUInt32LE(compressed.length, 18);
  localHeader.writeUInt32LE(data.length, 22);
  localHeader.writeUInt16LE(nameBytes.length, 26);
  const centralOffset = localHeader.length + nameBytes.length + compressed.length;
  const centralHeader = Buffer.alloc(46);
  centralHeader.writeUInt32LE(0x02014b50, 0);
  centralHeader.writeUInt16LE(20, 4);
  centralHeader.writeUInt16LE(20, 6);
  centralHeader.writeUInt16LE(8, 10);
  centralHeader.writeUInt32LE(compressed.length, 20);
  centralHeader.writeUInt32LE(data.length, 24);
  centralHeader.writeUInt16LE(nameBytes.length, 28);
  // 单条目 zip：本条目 local header 从文件偏移 0 开始。
  centralHeader.writeUInt32LE(0, 42);
  const endOfCentral = Buffer.alloc(22);
  endOfCentral.writeUInt32LE(0x06054b50, 0);
  endOfCentral.writeUInt16LE(1, 8);
  endOfCentral.writeUInt16LE(1, 10);
  endOfCentral.writeUInt32LE(centralHeader.length + nameBytes.length, 12);
  endOfCentral.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([localHeader, nameBytes, compressed, centralHeader, nameBytes, endOfCentral]);
}

/**
 * 512KB 固定种子伪随机数据（LCG）：deflate 后接近原始大小。
 * 该形态曾在 yauzl fd 读取路径上触发 openReadStream 永久挂起（见 zip-source.ts 修复注释）；
 * fromBuffer 路径可完整读取。若有人把解压退回 fd 路径，本测试会因超时失败。
 */
function buildHangingShapePayload() {
  let state = 0x12345678;
  const data = Buffer.alloc(512 * 1024);
  for (let index = 0; index < data.length; index += 1) {
    state = (state * 1664525 + 1013904223) >>> 0;
    data[index] = state & 0xff;
  }
  return data;
}

test('zip 解压：不可压缩大 deflate 条目在当前解压路径下可完整读取', { timeout: 30_000 }, async () => {
  const payload = buildHangingShapePayload();
  const zipBuffer = buildDeflatedSingleFileZip('fixture-plugin/payload.bin', payload);
  const server = createServer((_request, response) => {
    response.writeHead(200, { 'content-type': 'application/zip' });
    response.end(zipBuffer);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  let resolved;
  try {
    resolved = await resolveHttpZipSource({
      requireSingleRoot: true,
      stripRoot: true,
      url: `http://127.0.0.1:${address.port}/plugin.zip`,
    });
    const extracted = await readFile(join(resolved.path, 'payload.bin'));
    const expected = createHash('sha256').update(payload).digest('hex');
    const actual = createHash('sha256').update(extracted).digest('hex');
    assert.equal(actual, expected);
  } finally {
    await resolved?.cleanup();
    await new Promise((resolve) => {
      server.closeAllConnections?.();
      server.close(() => resolve());
    });
  }
});
