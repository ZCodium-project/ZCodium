import type { FileCopySource } from "@/file-menu/contract.js";

/** 已有 fileService 满足读取契约，无需新增另一份文件状态。 */
export function fileCopySourceExample(source: FileCopySource): FileCopySource {
  return source;
}
