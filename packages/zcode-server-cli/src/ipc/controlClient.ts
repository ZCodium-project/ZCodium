import { connect } from "node:net";
import { randomUUID } from "node:crypto";
import { SOURCE_SERVER_CONTROL_UNRESPONSIVE_ERROR_CODE } from "@zcode/shared";
import { controlResponseSchema, type ControlRequest } from "../contracts.js";
import { encodeJsonLine, JsonLineDecoder } from "./framing.js";
import { ControlRequestError } from "./controlError.js";

// Omit 不对 union 分发：直接 Omit<ControlRequest, "id"> 会丢掉 confirmation/force 等
// 变体字段，调用方无法以字面量构造合法请求。用分发式 Omit 保留每个命令的完整形状。
type DistributedOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type ControlRequestInput = DistributedOmit<ControlRequest, "id">;

export async function requestControl(
  endpoint: string,
  request: ControlRequestInput,
  timeoutMs = 10_000,
): Promise<unknown> {
  const id = randomUUID();
  const socket = connect(endpoint);
  const decoder = new JsonLineDecoder();
  return await new Promise<unknown>((resolve, reject) => {
    const timeout = setTimeout(() => {
      socket.destroy();
      // 超时说明 Supervisor 已接受连接却不应答；带公开码让桌面端显示“远端服务无响应”，
      // 而不是按文案被归类成连接超时。CLI 不在这里强杀 Supervisor（R2 §8.1）。
      reject(
        new ControlRequestError(
          SOURCE_SERVER_CONTROL_UNRESPONSIVE_ERROR_CODE,
          "Supervisor control request timed out",
        ),
      );
    }, timeoutMs);
    socket.setEncoding("utf8");
    socket.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.on("data", (chunk: string) => {
      try {
        const response = decoder.push(chunk)[0];
        if (response === undefined) return;
        const parsed = controlResponseSchema.parse(response);
        if (parsed.id !== id) return;
        clearTimeout(timeout);
        socket.end();
        if (parsed.ok) resolve(parsed.result);
        else
          reject(
            new ControlRequestError(
              parsed.error?.code ?? "request-failed",
              parsed.error?.message ?? "Supervisor request failed",
              parsed.error?.retryable,
            ),
          );
      } catch (error) {
        clearTimeout(timeout);
        socket.destroy();
        reject(error);
      }
    });
    socket.on("connect", () => socket.write(encodeJsonLine({ ...request, id })));
  });
}

/**
 * `requestControl` 是否因 control endpoint 不存在或无人监听而失败（socket 文件缺失、拒绝连接、
 * Windows 命名管道无效）。只表达“没有 Supervisor 在应答”，不包含已连上却不应答的超时。
 */
export function isControlEndpointUnavailable(error: unknown): boolean {
  if (typeof error !== "object" || error === null || !("code" in error)) return false;
  return error.code === "ENOENT" || error.code === "ECONNREFUSED" || error.code === "EINVAL";
}
