import type { IPlatformService, SaveFileResult } from "@zcode/shared";
import { getPathLeaf } from "@/lib/path.js";

export const MAX_FILE_COPY_BYTES = 50 * 1024 * 1024;
const COPY_CHUNK_BYTES = 1024 * 1024;

import type { FileCopySource } from "@/file-menu/contract.js";

export async function readFileCopy(source: FileCopySource, path: string): Promise<ArrayBuffer> {
  const before = await source.stat({ path });
  if (before.type !== "file") throw new Error("not_a_file");
  if (!Number.isSafeInteger(before.size) || before.size! < 0) {
    throw new Error("file_size_unavailable");
  }
  const size = before.size!;
  if (size > MAX_FILE_COPY_BYTES) throw new Error("file_too_large");
  const bytes = new Uint8Array(size);
  let offset = 0;
  while (offset < size) {
    const length = Math.min(COPY_CHUNK_BYTES, size - offset);
    const chunk = await source.readFileRange({ path, offset, length });
    if (chunk.byteLength === 0 || chunk.byteLength > length) throw new Error("file_changed");
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const after = await source.stat({ path });
  if (after.type !== "file" || after.size !== size || before.mtimeMs !== after.mtimeMs) {
    throw new Error("file_changed");
  }
  return bytes.buffer;
}

export async function saveFileCopy(
  source: FileCopySource,
  path: string,
  save: NonNullable<IPlatformService["saveFile"]>,
) {
  // 先完整读取原字节再交给保存对话框，选择同一文件也不会先截断源文件。
  const data = await readFileCopy(source, path);
  const result = await save({ data, suggestedName: getPathLeaf(path) || "download" });
  if (!result.success && !result.canceled) throw new Error(result.error || "save_failed");
  return result;
}

/** 浏览器只能确认交付下载，不能把 success 误报成已经写入磁盘；取消始终不提示。 */
export function fileSaveSuccessMessageId(result: SaveFileResult, canOpenLocalFiles?: boolean) {
  if (!result.success || result.canceled) return null;
  return canOpenLocalFiles ? "fileActions.saved" : "fileActions.downloadStarted";
}
