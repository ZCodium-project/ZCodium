import { createHash } from "node:crypto";
import { mkdtemp, mkdir, readFile, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ZCODE_VERSION } from "@zcode/shared";
import {
  importOfflineRuntime,
  resolveSourceServerReleaseAsset,
} from "../src/host/sourceServerReleaseResolver.js";

const target = { kind: "ssh", host: "example.com", username: "alice" } as const;
const probe = { platform: "linux", arch: "x64", installed: false } as const;
const fileName = "zcode-server-linux-x64.tar.gz";

function sha256(contents: string): string {
  return createHash("sha256").update(contents).digest("hex");
}

function descriptor(contents: string) {
  return {
    schemaVersion: 1,
    version: ZCODE_VERSION,
    archives: [
      {
        target: "linux-x64",
        version: ZCODE_VERSION,
        fileName,
        sha256: sha256(contents),
        sizeBytes: Buffer.byteLength(contents),
        urls: [fileName],
      },
    ],
  };
}

describe("Source Server release resolver", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("previews descriptor metadata without downloading the archive", async () => {
    const fetch = vi.fn(async (url: string | URL | Request) => {
      if (String(url).endsWith("source-server-release.json"))
        return new Response(JSON.stringify(descriptor("preview-package")));
      throw new Error("preview must not fetch archives");
    });
    const release = await resolveSourceServerReleaseAsset(
      probe,
      { remoteCdnBaseUrl: "https://release.test" },
      target,
      { fetch },
      { metadataOnly: true },
    );
    expect(release).toMatchObject({ version: ZCODE_VERSION, sizeBytes: 15 });
    expect(release.localArchivePath).toBeUndefined();
    expect(
      fetch.mock.calls.every(([url]) => String(url).endsWith("source-server-release.json")),
    ).toBe(true);
  });
  it("uses and verifies a staged local archive for local-download-upload", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-source-release-local-"));
    const releaseDir = join(root, "releases", ZCODE_VERSION);
    const contents = "local-source-server";
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, fileName), contents);
    await writeFile(
      join(releaseDir, "source-server-release.json"),
      JSON.stringify(descriptor(contents)),
    );

    const release = await resolveSourceServerReleaseAsset(probe, { mockCdnDir: root }, target);

    expect(release).toMatchObject({
      localArchivePath: join(releaseDir, fileName),
      target: "linux-x64",
      version: ZCODE_VERSION,
      sha256: sha256(contents),
      sizeBytes: Buffer.byteLength(contents),
    });
  });

  it("离线导入后禁用所有 fetch，remote-download 与预览仍只返回已验证本地包", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-offline-"));
    const source = join(root, "source");
    const cache = join(root, "cache");
    await mkdir(source);
    await writeFile(join(source, fileName), "offline-server");
    await writeFile(
      join(source, "source-server-release.json"),
      JSON.stringify(descriptor("offline-server")),
    );
    const result = await importOfflineRuntime(source, cache);
    expect(result).toEqual({ version: ZCODE_VERSION, targets: ["linux-x64"] });
    const fetchMock = vi.fn().mockRejectedValue(new Error("公网禁止"));
    vi.stubGlobal("fetch", fetchMock);
    for (const metadataOnly of [false, true]) {
      const release = await resolveSourceServerReleaseAsset(
        probe,
        {
          remoteCacheDir: cache,
          runtimeAssetSettings: { mode: "offline" },
          remoteCdnBaseUrl: "https://must-not-connect.test",
        },
        { ...target, assetInstallMode: "remote-download" },
        { fetch: fetchMock },
        { metadataOnly },
      );
      expect(await readFile(release.localArchivePath!, "utf8")).toBe("offline-server");
      expect(release.urls).toEqual([]);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("离线缺包明确失败，绝不回退公网", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-offline-missing-"));
    const fetchMock = vi.fn().mockRejectedValue(new Error("公网禁止"));
    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        {
          remoteCacheDir: root,
          runtimeAssetSettings: { mode: "offline" },
          remoteCdnBaseUrl: "https://must-not-connect.test",
        },
        target,
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("拒绝错版本与符号链接，不把未校验输入写进缓存", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-offline-reject-"));
    const source = join(root, "source");
    await mkdir(source);
    await writeFile(
      join(source, "source-server-release.json"),
      JSON.stringify({ ...descriptor("data"), version: "wrong-version" }),
    );
    await expect(importOfflineRuntime(source, join(root, "cache"))).rejects.toThrow();
    await writeFile(join(source, "source-server-release.json"), JSON.stringify(descriptor("data")));
    await writeFile(join(root, "external"), "data");
    await symlink(join(root, "external"), join(source, fileName));
    await expect(importOfflineRuntime(source, join(root, "cache"))).rejects.toThrow("verification");
  });

  it("允许只导入所需平台，离线访问未导入的平台不联网", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-offline-platform-"));
    const source = join(root, "source");
    const cache = join(root, "cache");
    await mkdir(source);
    const meta = descriptor("data");
    await writeFile(
      join(source, "source-server-release.json"),
      JSON.stringify({
        ...meta,
        archives: [
          ...meta.archives,
          {
            ...meta.archives[0],
            target: "linux-arm64",
            fileName: "zcode-server-linux-arm64.tar.gz",
          },
        ],
      }),
    );
    await writeFile(join(source, fileName), "data");
    expect((await importOfflineRuntime(source, cache)).targets).toEqual(["linux-x64"]);
    const fetchMock = vi.fn().mockRejectedValue(new Error("不能联网"));
    await expect(
      resolveSourceServerReleaseAsset(
        { ...probe, arch: "arm64" },
        { remoteCacheDir: cache, runtimeAssetSettings: { mode: "offline" } },
        target,
        { fetch: fetchMock },
      ),
    ).rejects.toThrow("offline");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("镜像独占来源，不接受 descriptor 内其他公网域名", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-mirror-"));
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      expect(url.startsWith("https://mirror.example.test/")).toBe(true);
      if (url.endsWith(".json")) {
        const meta = descriptor("data");
        meta.archives[0].urls = ["https://other-public.example.test/archive.tar.gz"];
        return new Response(JSON.stringify(meta));
      }
      return new Response("data");
    });
    await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCacheDir: root,
        runtimeAssetSettings: {
          mode: "online",
          baseUrl: `https://mirror.example.test/v${ZCODE_VERSION}`,
        },
        remoteCdnBaseUrl: "https://default-must-not-use.test",
      },
      target,
      { fetch: fetchMock },
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("损坏导入失败但不改变原有已验证代", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-offline-integrity-"));
    const source = join(root, "source");
    const cache = join(root, "cache");
    await mkdir(source);
    await writeFile(join(source, fileName), "good");
    await writeFile(join(source, "source-server-release.json"), JSON.stringify(descriptor("good")));
    await importOfflineRuntime(source, cache);
    await writeFile(join(source, fileName), "broken");
    await expect(importOfflineRuntime(source, cache)).rejects.toThrow("verification");
    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCacheDir: cache,
        runtimeAssetSettings: { mode: "offline" },
      },
      target,
    );
    expect(await readFile(release.localArchivePath!, "utf8")).toBe("good");
  });

  it("在线完整缓存命中无需再次请求描述文件", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcodium-cache-first-"));
    const dir = join(root, "source-server", ZCODE_VERSION);
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, fileName), "cached");
    await writeFile(join(dir, "source-server-release.json"), JSON.stringify(descriptor("cached")));
    const fetchMock = vi.fn().mockRejectedValue(new Error("不应联网"));
    const result = await resolveSourceServerReleaseAsset(probe, { remoteCacheDir: root }, target, {
      fetch: fetchMock,
    });
    expect(result.localArchivePath).toBe(join(dir, fileName));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the staged local archive for development even when SSH prefers remote download", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-source-release-dev-local-"));
    const releaseDir = join(root, "releases", ZCODE_VERSION);
    const contents = "development-source-server";
    await mkdir(releaseDir, { recursive: true });
    await writeFile(join(releaseDir, fileName), contents);
    await writeFile(
      join(releaseDir, "source-server-release.json"),
      JSON.stringify(descriptor(contents)),
    );
    const fetchMock = vi.fn(async () => {
      throw new Error("development resolution must not access CDN");
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        mockCdnDir: root,
        sourceServerArtifactPolicy: "development-content-addressed",
      },
      { ...target, assetInstallMode: "remote-download" },
    );

    expect(release.localArchivePath).toBe(join(releaseDir, fileName));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fails closed without a staged local development descriptor", async () => {
    const fetchMock = vi.fn(async () => new Response("production-release", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        {
          sourceServerArtifactPolicy: "development-content-addressed",
          remoteCdnBaseUrls: ["https://cdn.example.test/releases"],
        },
        target,
      ),
    ).rejects.toThrow("run pnpm bootstrap:with-remote");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("resolves descriptor URLs without downloading the archive for remote-download", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-source-release-remote-"));
    const contents = "remote-source-server";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (!url.endsWith("/source-server-release.json")) return new Response(null, { status: 404 });
      return new Response(JSON.stringify(descriptor(contents)), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCdnBaseUrls: [`https://cdn.example.test/releases/${ZCODE_VERSION}`],
        remoteCacheDir: root,
      },
      { ...target, assetInstallMode: "remote-download" },
    );

    expect(release).toEqual({
      target: "linux-x64",
      version: ZCODE_VERSION,
      sha256: sha256(contents),
      sizeBytes: Buffer.byteLength(contents),
      urls: [`https://cdn.example.test/releases/${ZCODE_VERSION}/${fileName}`],
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("downloads and verifies the descriptor archive into the Desktop cache", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-source-release-cache-"));
    const contents = "cached-source-server";
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.endsWith("/source-server-release.json")) {
        return new Response(JSON.stringify(descriptor(contents)), { status: 200 });
      }
      if (url.endsWith(`/${fileName}`)) return new Response(contents, { status: 200 });
      return new Response(null, { status: 404 });
    });
    vi.stubGlobal("fetch", fetchMock);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCdnBaseUrls: [`https://cdn.example.test/releases/${ZCODE_VERSION}`],
        remoteCacheDir: root,
      },
      target,
    );

    expect(release.localArchivePath).toBe(join(root, "source-server", ZCODE_VERSION, fileName));
    await expect(readFile(release.localArchivePath!, "utf8")).resolves.toBe(contents);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("uses the injected remote asset network for descriptor and archive downloads", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-source-release-proxy-"));
    const contents = "proxy-source-server";
    const remoteAssetFetch = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      if (url.endsWith("/source-server-release.json")) {
        return new Response(JSON.stringify(descriptor(contents)), { status: 200 });
      }
      if (url.endsWith(`/${fileName}`)) return new Response(contents, { status: 200 });
      return new Response(null, { status: 404 });
    });
    const directFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("remote asset direct fetch is forbidden"));
    vi.stubGlobal("fetch", directFetch);

    const release = await resolveSourceServerReleaseAsset(
      probe,
      {
        remoteCdnBaseUrls: [`https://cdn.example.test/releases/${ZCODE_VERSION}`],
        remoteCacheDir: root,
      },
      target,
      { fetch: remoteAssetFetch },
    );

    expect(release.localArchivePath).toBe(join(root, "source-server", ZCODE_VERSION, fileName));
    expect(remoteAssetFetch).toHaveBeenCalledTimes(2);
    expect(directFetch).not.toHaveBeenCalled();
  });

  it("does not fall back to direct fetch when the injected network fails", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-source-release-proxy-failure-"));
    const directFetch = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(descriptor("direct-source-server"))),
    );
    vi.stubGlobal("fetch", directFetch);
    const remoteAssetFetch = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new Error("proxy unavailable"));

    await expect(
      resolveSourceServerReleaseAsset(
        probe,
        {
          remoteCdnBaseUrls: [`https://cdn.example.test/releases/${ZCODE_VERSION}`],
          remoteCacheDir: root,
        },
        target,
        { fetch: remoteAssetFetch },
      ),
    ).rejects.toMatchObject({
      message: "Unable to resolve Source Server release descriptor",
      cause: expect.objectContaining({ message: "proxy unavailable" }),
    });
    expect(remoteAssetFetch).toHaveBeenCalled();
    expect(directFetch).not.toHaveBeenCalled();
  });
});
