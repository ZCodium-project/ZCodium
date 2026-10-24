import { expect, it } from "vitest";
import { parseWebRemoteControlAppPayload } from "../src/validation.js";

it("project bridge 只携带 Host 准入意图，不传执行目录或 Root 草稿回调", () => {
  const payload = {
    zcode_type: "workspace-bridge-open",
    requestId: "r",
    bridgeSessionId: "b",
    workspaceKey: "/current",
    project: { projectId: "project", hostId: "local" },
  };
  expect(parseWebRemoteControlAppPayload(payload)).toEqual(payload);
  expect(parseWebRemoteControlAppPayload({ ...payload, taskId: "existing" })).toBeNull();
});
it("历史文件/任务通过完整 Host 地址恢复，不允许缺 Host 的文件任务意图", () => {
  const payload = {
    zcode_type: "workspace-bridge-open",
    requestId: "r",
    bridgeSessionId: "b",
    workspaceKey: "/old-cwd",
    fileTreeTaskId: "task",
    taskHostId: "local",
  };
  expect(parseWebRemoteControlAppPayload(payload)).toEqual(payload);
  expect(parseWebRemoteControlAppPayload({ ...payload, taskHostId: undefined })).toBeNull();
});
it("授权缺席可以明确 fail closed，遥测 payload 仍被协议拒绝", () => {
  expect(
    parseWebRemoteControlAppPayload({
      zcode_type: "app-error",
      reason: "auth-required",
      error: "authorization unavailable",
    }),
  ).not.toBeNull();
  expect(parseWebRemoteControlAppPayload({ zcode_type: "telemetry-report", event: {} })).toBeNull();
});
it("实际查看不能由 Web 注入可信 remoteSessionId，必须由 Main 当前 bridge 补齐", () => {
  const payload = {
    zcode_type: "mobile-task-view-update",
    epoch: "epoch",
    seq: 1,
    bridgeSessionId: "bridge",
    view: { workspacePath: "/project", taskId: "task" },
  };
  expect(parseWebRemoteControlAppPayload(payload)).toEqual(payload);
  expect(
    parseWebRemoteControlAppPayload({
      ...payload,
      view: { ...payload.view, remoteSessionId: "untrusted" },
    }),
  ).toBeNull();
});
