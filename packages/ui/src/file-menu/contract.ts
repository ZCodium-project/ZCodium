import type { FileStat } from "@zcode/shared";

/** 文件所属 Host 的读取端口。路径保持该 Host 的语义，不转换成本机路径。 */
export interface FileCopySource {
  stat(params: { path: string }): Promise<Pick<FileStat, "type" | "size" | "mtimeMs">>;
  readFileRange(params: { path: string; offset: number; length: number }): Promise<Uint8Array>;
}
