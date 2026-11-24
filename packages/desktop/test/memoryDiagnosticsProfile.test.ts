import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { unzip } from "fflate";
import { expect, it, vi } from "vitest";
import { createFeedbackService, getAppConfigDir, setDataBaseDir } from "@zcode/services/node";
import { createFeedbackLogArchiveFromExportLogs, exportLogs } from "../src/main/exportLogs.js";

const { home } = vi.hoisted(() => ({ home: vi.fn<() => string>() }));
vi.mock("node:os", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:os")>()),
  homedir: home,
}));
vi.mock("electron", () => ({ app: { isPackaged: false }, dialog: {}, nativeImage: {}, shell: {} }));
vi.mock("../src/main/logger.js", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

const own = "01111111-1111-4111-8111-111111111111";
const other = "02222222-2222-4222-8222-222222222222";
const legacy = "03333333-3333-4333-8333-333333333333";

const recordName = (id: string) => `memory-123-${id}.jsonl`;

async function seed(directory: string, instanceId: string) {
  await mkdir(directory, { recursive: true });
  await writeFile(
    join(directory, recordName(instanceId)),
    JSON.stringify({
      format: "zcode-cli-memory-v1",
      timestamp: Date.now(),
      instanceId,
      pid: 123,
      version: "3.18.1",
      commit: "abcdef01",
      node: "24.14.0",
      v8: "14.0",
      bundleSha256: "a".repeat(64),
      sampler: {
        state: "active",
        intervalBytes: 524288,
        windowStartedAt: 0,
        profileCapturedAt: 0,
        durationMs: 1,
      },
      samples: [],
      allocations: [],
      privateUnexpectedField: "NEVER_UPLOAD_THIS",
    }),
  );
}

async function readZip(path: string): Promise<Record<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    void readFile(path).then(
      (bytes) =>
        unzip(bytes, (error, result) => {
          if (error) reject(error);
          else resolve(result);
        }),
      reject,
    );
  });
}

it("exports diagnostics only from its profile and projects both feedback ZIPs", async () => {
  const root = await mkdtemp(join(tmpdir(), "memory-diagnostics-profile-"));
  try {
    const rootA = join(root, "home-A");
    const rootB = join(root, "data-B");
    const fallback = join(rootA, ".zcodium", "cli", "memory-diagnostics");
    const custom = join(rootB, ".zcodium", "cli", "memory-diagnostics", "profile-v1");
    home.mockReturnValue(rootA);
    setDataBaseDir(rootB);
    await seed(custom, own);
    await seed(join(fallback, "profile-v1"), other);
    await seed(fallback, legacy);
    const homeCliLog = join(rootA, ".zcodium", "cli", "log");
    await mkdir(homeCliLog, { recursive: true });
    await writeFile(join(homeCliLog, "cli.log"), "existing CLI log");
    const feedback = createFeedbackService({
      credentialService: {} as never,
      oauthService: {} as never,
      apiClient: {} as never,
    });
    const compact = () => feedback.prepareCompactLogArchive();
    const full = () => createFeedbackLogArchiveFromExportLogs(getAppConfigDir());
    const manual = () =>
      exportLogs({
        getExportLogDir: () => join(root, "export"),
        getExportLogStageDir: () => join(root, "stage"),
        showItemInFolder: vi.fn(),
      });

    for (const createArchive of [compact, full, manual]) {
      const result = await createArchive();
      expect(result.path).toBeTruthy();
      const entries = await readZip(result.path!);
      const diagnostics = Object.keys(entries).filter((key) =>
        key.includes("/memory-diagnostics/"),
      );
      expect(diagnostics.map((key) => key.split("/").at(-1))).toEqual([recordName(own)]);
      const content = new TextDecoder().decode(entries[diagnostics[0]!]);
      expect(JSON.parse(content).instanceId).toBe(own);
      if (createArchive !== manual) expect(content).not.toContain("NEVER_UPLOAD_THIS");
      if (createArchive !== compact) {
        expect(Object.keys(entries).some((key) => key.endsWith("/cli/log/cli.log"))).toBe(true);
      }
    }

    await rm(custom, { recursive: true });
    for (const createArchive of [compact, full]) {
      const archive = await createArchive();
      expect(
        Object.keys(await readZip(archive.path)).some((key) =>
          key.includes("/memory-diagnostics/"),
        ),
      ).toBe(false);
    }

    setDataBaseDir(rootA);
    expect(
      Object.keys(await readZip((await compact()).path)).filter((key) =>
        key.includes("/memory-diagnostics/"),
      ),
    ).toEqual([`.zcodium/cli/memory-diagnostics/${recordName(other)}`]);
  } finally {
    setDataBaseDir(null);
    await rm(root, { recursive: true, force: true });
  }
});
