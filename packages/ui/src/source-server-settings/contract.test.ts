import { describe, expect, it, vi } from "vitest";
// 根测试入口只收集 managed contract.test.ts；设备交互回归由同一合同入口纳入。
import "./deviceManagement.test.js";
import { SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE } from "./contract.js";
import {
  runSourceServerUpdate,
  validateProfileEdit,
  buildProfileEditTarget,
} from "./sourceServerSettingsActions.js";

describe("ZUP10 自有设备管理准入", () => {
  it("升级先执行 guard；明确确认后才 force，且保持 expectedTarget", async () => {
    const updateSource = vi
      .fn()
      .mockRejectedValueOnce({ code: SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE })
      .mockResolvedValueOnce({ generation: 2 });
    const confirmForce = vi.fn().mockResolvedValue(true);
    const expectedTarget = { kind: "docker" as const, container: "owned" };
    await runSourceServerUpdate({
      management: { updateSource },
      profileId: "p",
      confirmForce,
      expectedTarget,
    });
    expect(updateSource.mock.calls).toEqual([
      [{ profileId: "p", force: false, expectedTarget }],
      [{ profileId: "p", force: true, expectedTarget }],
    ]);
    expect(confirmForce).toHaveBeenCalledOnce();
  });
  it("取消强制升级不发送第二个命令；其它失败不申请 force", async () => {
    const updateSource = vi
      .fn()
      .mockRejectedValue({ code: SOURCE_SERVER_UPDATE_RUNNING_TASKS_ERROR_CODE });
    expect(
      await runSourceServerUpdate({
        management: { updateSource },
        profileId: "p",
        confirmForce: async () => false,
      }),
    ).toBeNull();
    expect(updateSource).toHaveBeenCalledOnce();
    const confirmForce = vi.fn();
    updateSource.mockRejectedValue(new Error("network"));
    await expect(
      runSourceServerUpdate({ management: { updateSource }, profileId: "p", confirmForce }),
    ).rejects.toThrow("network");
    expect(confirmForce).not.toHaveBeenCalled();
  });
  const fields = {
    host: "example.test",
    port: "22",
    username: "user",
    sshAuthMethod: "password" as const,
    password: "",
    privateKeyPath: "",
    privateKeyPassphrase: "",
    assetInstallMode: "local-download-upload" as const,
    wslDistro: "",
    wslUser: "",
    dockerContainer: "",
    manualDockerContainer: "",
    selectedSshConfigAlias: null,
  };
  const target = {
    kind: "ssh" as const,
    host: "example.test",
    username: "user",
    passwordCredentialKey: "saved",
    sshConfigAlias: "owned",
    resourcePackages: { selectedPackageIds: ["zcode-agent"] },
  };
  it("留空沿用已存密码，且保留 #68 离线安装和资源选择", () => {
    expect(validateProfileEdit(target, fields)).toBeNull();
    const edited = buildProfileEditTarget(target, fields);
    expect(edited).toMatchObject({
      kind: "ssh",
      assetInstallMode: "local-download-upload",
      resourcePackages: target.resourcePackages,
      sshConfigAlias: "owned",
    });
    expect(edited).not.toHaveProperty("password");
  });
  it("拒绝无凭据密码线路和非法端口；校验 WSL user / Docker 手输", () => {
    expect(validateProfileEdit({ ...target, passwordCredentialKey: undefined }, fields)).toBe(
      "ssh.validation.passwordRequired",
    );
    expect(validateProfileEdit(target, { ...fields, port: "70000" })).toBe(
      "settings.source.invalidPort",
    );
    expect(validateProfileEdit({ kind: "wsl" }, { ...fields, wslUser: "bad/user" })).toBe(
      "wsl.validation.invalidUser",
    );
    expect(
      buildProfileEditTarget(
        { kind: "docker", container: "old" },
        { ...fields, dockerContainer: "selected", manualDockerContainer: " manual " },
      ),
    ).toEqual({ kind: "docker", container: "manual" });
  });
});
