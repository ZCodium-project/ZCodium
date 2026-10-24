import { expect, it, vi } from "vitest";
import { createSourceServerSettingsNavigation } from "@/source-server-settings/index.js";
import type { SourceServerSettingsRootPorts } from "@/source-server-settings/contract.js";

function fixture() {
  const snapshot = {
    servers: [{ sourceServerId: "qa-source", preferredProfileId: "qa-profile" }],
    profiles: [
      {
        profileId: "qa-profile",
        sourceServerId: "qa-source",
        target: { kind: "ssh", host: "qa.test", username: "fixture" },
      },
    ],
    states: [{ profileId: "qa-profile", sourceServerId: "qa-source", state: "online" }],
  };
  const ports = {
    management: {
      getSnapshot: vi.fn(async () => snapshot),
      connectProfile: vi.fn(async () => snapshot),
      disconnectSource: vi.fn(async () => snapshot),
    },
    projects: { readDirectory: vi.fn(async () => ({ path: "/remote-home", entries: [] })) },
    remote: {
      saveHost: vi.fn(async (input) => ({
        ...input,
        membershipId: "member",
        kind: "ssh",
        position: 0,
      })),
    },
    isCurrent: () => true,
    openConnection: vi.fn(),
    openProjectPicker: vi.fn(),
    reportError: vi.fn(),
  };
  return {
    ports,
    snapshot,
    navigation: createSourceServerSettingsNavigation(
      ports as unknown as SourceServerSettingsRootPorts,
    ),
  };
}

it("设备动作复用管理 owner，连接成功不创建项目或 Agent", async () => {
  const f = fixture();
  f.navigation.onCreateConnection?.();
  expect(f.ports.openConnection).toHaveBeenCalledOnce();
  await f.navigation.onConnectProfile?.("qa-profile");
  await f.navigation.onDisconnectSource?.("qa-source");
  expect(f.ports.management.connectProfile).toHaveBeenCalledWith("qa-profile");
  expect(f.ports.management.disconnectSource).toHaveBeenCalledWith("qa-source");
  expect(f.ports.openProjectPicker).not.toHaveBeenCalled();
  expect(f.ports.remote.saveHost).not.toHaveBeenCalled();
});

it("历史目录不猜项目归属，只交给原项目选择器和同 Source Host", async () => {
  const f = fixture();
  await f.navigation.onOpenProject?.("qa-source", "/repo", "qa-profile");
  expect(f.ports.management.connectProfile).toHaveBeenCalledWith("qa-profile");
  expect(f.ports.openProjectPicker).toHaveBeenCalledWith({
    host: expect.objectContaining({
      membershipId: "member",
      target: expect.objectContaining({ host: "qa.test" }),
    }),
    path: "/repo",
  });
  expect(f.ports.projects.readDirectory).not.toHaveBeenCalled();
});

it("需要身份确认或离线时不能继续保存入口/打开项目", async () => {
  const f = fixture();
  f.snapshot.states[0].state = "identity-change-pending";
  await expect(f.navigation.onOpenProject?.("qa-source", "/repo")).rejects.toThrow(
    "project.host-offline",
  );
  expect(f.ports.remote.saveHost).not.toHaveBeenCalled();
  expect(f.ports.openProjectPicker).not.toHaveBeenCalled();
});

it("Source 页面关闭后的迟到连接只保留 owner 事实，不抢导航或复活入口", async () => {
  const f = fixture();
  let current = true;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  f.ports.management.connectProfile.mockImplementation(async () => {
    await gate;
    return f.snapshot;
  });
  const opening = f.navigation.onOpenProject!("qa-source", "/repo", undefined, () => current);
  await vi.waitFor(() => expect(f.ports.management.connectProfile).toHaveBeenCalledOnce());
  current = false;
  release();
  await opening;
  expect(f.ports.remote.saveHost).not.toHaveBeenCalled();
  expect(f.ports.openProjectPicker).not.toHaveBeenCalled();
});
