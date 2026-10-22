import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir, userInfo } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ZCODE_VERSION } from "@zcode/shared";
import { createSourceServerTransportAdapter } from "@zcode/server/source-server";
import {
  importOfflineRuntime,
  resolveSourceServerReleaseAsset,
} from "../src/host/sourceServerReleaseResolver.js";
import { connectServerRemoteOverDuplex } from "../src/host/serverRemoteConnection.js";

// UT 源码没有打包期版本 define；显式模拟待验收发行版，不改写下载的 descriptor 或归档。
vi.mock("@zcode/shared", async (importOriginal) => {
  const shared = await importOriginal<typeof import("@zcode/shared")>();
  return {
    ...shared,
    ZCODE_VERSION: process.env.ZCODIUM_TEST_RELEASE_VERSION ?? shared.ZCODE_VERSION,
  };
});

it.skipIf(!process.env.ZCODIUM_TEST_PUBLIC_RELEASE)(
  "真实 Release：完整版本地址下载并校验，二次读取无网络",
  async () => {
    const cache = await mkdtemp(join(tmpdir(), "zcodium-public-release-"));
    const requests: string[] = [];
    const network = {
      fetch: async (input: string | URL | Request, init?: RequestInit) => {
        requests.push(String(input));
        return await fetch(input, init);
      },
    };
    const base = `https://github.com/ZCodium-project/ZCodium/releases/download/v${ZCODE_VERSION}`;
    const target = { kind: "ssh" as const, host: "example.test", username: "fixture" };
    const probe = {
      platform: process.platform === "linux" ? "linux" : "darwin",
      arch: process.arch,
      installed: false,
    };
    const result = await resolveSourceServerReleaseAsset(
      probe,
      { remoteCacheDir: cache, remoteCdnBaseUrl: base },
      target,
      network,
    );
    expect((await readFile(result.localArchivePath!)).length).toBe(result.sizeBytes);
    expect(requests).toEqual([
      `${base}/source-server-release.json`,
      `${base}/zcode-server-${probe.platform}-${probe.arch}.tar.gz`,
    ]);
    const forbidden = vi.fn().mockRejectedValue(new Error("缓存命中不应联网"));
    const cached = await resolveSourceServerReleaseAsset(
      probe,
      { remoteCacheDir: cache, remoteCdnBaseUrl: base },
      target,
      { fetch: forbidden },
    );
    expect(cached.localArchivePath).toBe(result.localArchivePath);
    expect(forbidden).not.toHaveBeenCalled();
  },
  180_000,
);

// 显式选择隔离 sshd，不读取用户 SSH 配置或真实远端凭据。缺少测试基础设施时不假报成功。
it.skipIf(!process.env.ZCODIUM_TEST_SSH_ROOT)(
  "真实 SSH：离线导入、上传新装、握手与再次连接均不请求资源网络",
  async () => {
    const root = process.env.ZCODIUM_TEST_SSH_ROOT!;
    const port = Number(process.env.ZCODIUM_TEST_SSH_PORT ?? "24268");
    const target = {
      kind: "ssh" as const,
      host: "127.0.0.1",
      port,
      username: process.env.ZCODIUM_TEST_SSH_USER ?? userInfo().username,
      privateKeyPath: join(root, "client_key"),
      assetInstallMode: "remote-download" as const,
    };
    const cache = await mkdtemp(join(tmpdir(), "zcodium-ssh-offline-cache-"));
    const result = await importOfflineRuntime(join(root, "release"), cache);
    expect(result.version).toBe(ZCODE_VERSION);
    const forbiddenFetch = vi.fn().mockRejectedValue(new Error("资源公网出口已禁用"));
    const adapter = createSourceServerTransportAdapter("ssh");
    const phases: string[] = [];
    const context = {
      onLog: (event: { phase: string }) => {
        phases.push(event.phase);
      },
    };
    let connection: Awaited<ReturnType<typeof connectServerRemoteOverDuplex>> | undefined;
    try {
      const probe = await adapter.probe(target, context);
      expect(probe.installPath).toContain(join(root, "home"));
      const release = await resolveSourceServerReleaseAsset(
        probe,
        { remoteCacheDir: cache, runtimeAssetSettings: { mode: "offline" } },
        target,
        { fetch: forbiddenFetch },
      );
      expect(release.localArchivePath).toBeTruthy();
      expect(release.urls).toEqual([]);
      await adapter.installOrUpdate(target, release, context);
      expect(phases).toContain("upload");
      expect(phases).not.toContain("download");
      const ingress = await adapter.ensureDaemon(target, context);
      connection = await connectServerRemoteOverDuplex({
        ingressToken: ingress.ingressToken,
        createConnection: () => adapter.openChannel(target, ingress, context),
      });
      expect(connection.serverInfo.version).toBe(ZCODE_VERSION);
      expect(connection.serverInfo.compatibility?.productVersion).toBe(ZCODE_VERSION);
      await connection.services.settingService.get();
      connection.dispose();
      connection = undefined;
      const again = await adapter.probe(target, context);
      expect(again.installed).toBe(true);
      expect(again.installedVersion).toBe(ZCODE_VERSION);
      const ingress2 = await adapter.ensureDaemon(target, context);
      connection = await connectServerRemoteOverDuplex({
        ingressToken: ingress2.ingressToken,
        createConnection: () => adapter.openChannel(target, ingress2, context),
      });
      expect(connection.serverInfo.version).toBe(ZCODE_VERSION);
      expect(forbiddenFetch).not.toHaveBeenCalled();
      expect(await readFile(release.localArchivePath!)).toBeTruthy();
    } finally {
      connection?.dispose();
      await adapter.exec(target, ["stop", "--json"], {}).catch(() => undefined);
      adapter.dispose?.();
    }
  },
  180_000,
);
