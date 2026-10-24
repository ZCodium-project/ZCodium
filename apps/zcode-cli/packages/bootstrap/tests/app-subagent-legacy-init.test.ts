import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createSqliteSessionStore } from "@zcode/adapters/storage";
import { createConfig } from "@zcode/adapters/config";
import { createRootTraceContext } from "@zcode/contracts";
import { zcodeProtocolMethods, type ZCodeProtocolMessage } from "@zcode/shared";
import { V4_METHODS, conversationTopic } from "@zcode/shared/zcode-protocol-v4";
import { describe, expect, it, vi } from "vitest";
import { createRegistryBackedTestApp } from "./helpers/registry-backed-test-app.js";
import type { ZCodeApp } from "../src/app/types.js";
import { createWorkflowChildSkillPort } from "../src/app/script-workflow-child-runtime.js";
import { ZCodeProtocolAgentServer } from "../src/zcode-protocol/server.js";

const { resolveRuntimeConfig } = vi.hoisted(() => ({ resolveRuntimeConfig: vi.fn() }));
vi.mock("../src/app/runtime-config.js", async (importOriginal) => {
  const original = await importOriginal<typeof import("../src/app/runtime-config.js")>();
  return {
    ...original,
    resolveAppRuntimeConfig: (...args: Parameters<typeof original.resolveAppRuntimeConfig>) => {
      resolveRuntimeConfig(...args);
      return original.resolveAppRuntimeConfig(...args);
    },
  };
});

describe("App 附加目录装配", () => {
  const capabilityName = "zcodium-parity-review";

  async function withDirectoryApp(
    check: (fixture: {
      app: ZCodeApp;
      main: string;
      extra: string;
      requests: string[];
      store: Awaited<ReturnType<typeof createSqliteSessionStore>>;
    }) => Promise<void>,
  ) {
    const root = await mkdtemp(join(tmpdir(), "zcodium-directory-app-"));
    const main = join(root, "frontend");
    const extra = join(root, "backend");
    const store = await createSqliteSessionStore({ dbPath: ":memory:" });
    const requests: string[] = [];
    let app: ZCodeApp | undefined;
    try {
      vi.stubEnv("HOME", join(root, "home"));
      vi.stubEnv("USERPROFILE", join(root, "home"));
      for (const [directory, marker] of [
        [main, "main"],
        [extra, "extra"],
      ] as const) {
        await mkdir(join(directory, ".git"), { recursive: true });
        const skill = join(directory, ".agents", "skills", capabilityName);
        const commands = join(directory, ".zcode", "commands");
        const agents = join(directory, ".zcode", "agents");
        await Promise.all(
          [skill, commands, agents].map((path) => mkdir(path, { recursive: true })),
        );
        await writeFile(join(directory, "AGENTS.md"), `${marker}-instructions-marker`);
        await writeFile(
          join(skill, "SKILL.md"),
          `---\nname: ${capabilityName}\ndescription: ${marker}-skill-marker\n---\n${marker}-skill-body`,
        );
        await writeFile(
          join(commands, `${capabilityName}.md`),
          `---\ndescription: ${marker} command\n---\n${marker}-command-marker $ARGUMENTS`,
        );
        await writeFile(
          join(agents, `${capabilityName}.md`),
          `---\nname: ${capabilityName}\ndescription: ${marker}-agent-marker\n---\n${marker}-agent-body`,
        );
      }
      await writeFile(
        join(main, ".zcode", "config.json"),
        JSON.stringify({
          permission: { mode: "build" },
          plugins: { enabled: false },
          features: { memory: false },
        }),
      );
      // 附加目录故意放入可执行配置；它们只能作为能力来源，不能进入 cwd 的配置链。
      await writeFile(
        join(extra, ".zcode", "config.json"),
        JSON.stringify({
          permission: { mode: "yolo" },
          features: { memory: true },
          memory: { use: false },
          skills: { enabled: false },
          mcp: { servers: { "extra-only": { type: "stdio", command: "must-not-start" } } },
          hooks: {
            enabled: true,
            events: { SessionStart: [{ hooks: [{ type: "command", command: "must-not-run" }] }] },
          },
          plugins: { enabled: true, dirs: [join(extra, "extra-plugin")] },
        }),
      );
      app = await createRegistryBackedTestApp({
        additionalDirectories: [extra, extra, main],
        env: { ZCODE_STORAGE_DIR: join(root, "storage") },
        skipUserConfig: true,
        sessionStore: store,
        runtimeConfig: { workingDirectory: main, mcp: { enabled: false } },
        modelExecutor: {
          async generateText(request) {
            requests.push(JSON.stringify(request.messages));
            return {
              text: JSON.stringify({ reasoning: "ok", verdict: "pass" }),
              finishReason: "stop",
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            };
          },
        },
      });
      await check({ app, main, extra, requests, store });
    } finally {
      await app?.close?.();
      store.close();
      await rm(root, { recursive: true, force: true });
      vi.unstubAllEnvs();
    }
  }

  it("真实 App 的 skill catalog 保留 cwd 与附加目录的同名来源", async () => {
    await withDirectoryApp(async ({ app, extra }) => {
      const catalog = await app.runtime.getSkillCatalog(
        createRootTraceContext({ sessionId: app.sessionId }),
      );
      const skills = catalog.skills.filter((skill) => skill.name === capabilityName);
      expect(skills).toHaveLength(2);
      expect(skills).toContainEqual(
        expect.objectContaining({
          qualifiedName: `backend/${capabilityName}`,
          path: join(extra, ".agents", "skills", capabilityName, "SKILL.md"),
        }),
      );
    });
  }, 30_000);

  it("真实模型上下文同时包含 cwd 与附加目录的限定 subagent", async () => {
    await withDirectoryApp(async ({ app, requests }) => {
      await app.submitPrompt("inspect available agents");
      expect(requests[0]).toContain("main-agent-marker");
      expect(requests[0]).toContain("extra-agent-marker");
      expect(requests[0]).toContain(`backend/${capabilityName}`);
    });
  }, 30_000);

  it("输入装配按限定来源展开附加目录 command，不覆盖 cwd command", async () => {
    await withDirectoryApp(async ({ app, requests }) => {
      await app.submitPrompt(`/${capabilityName} first`);
      expect(requests[0]).toContain("main-command-marker first");
      expect(requests[0]).not.toContain("extra-command-marker");
      await app.submitPrompt(`/backend/${capabilityName} second`);
      expect(requests[1]).toContain("extra-command-marker second");
    });
  }, 30_000);

  it("AGENTS/settings/MCP/hooks/plugins/memory/permissions 仍只消费 cwd 链", async () => {
    await withDirectoryApp(async ({ app, main, extra, requests }) => {
      const extraConfig = createConfig({ workingDirectory: extra, skipUserConfig: true, env: {} });
      // 先证明负向 fixture 有效，避免配置本身解析失败造成「未扩信任面」的假阳性。
      expect(extraConfig.config.permission.mode).toBe("yolo");
      expect(extraConfig.config.skills.enabled).toBe(false);
      expect(extraConfig.config.mcp.servers["extra-only"]).toBeDefined();
      expect(extraConfig.sources.project.workspaceHookSnapshot?.hooks).toHaveLength(1);
      expect(extraConfig.sources.plugins.dirs.workspace).toContain(join(extra, "extra-plugin"));
      await app.submitPrompt("check directory boundary");
      expect(requests[0]).toContain("main-instructions-marker");
      expect(requests[0]).not.toContain("extra-instructions-marker");
      expect(app.getMode()).toBe("build");
      expect(app.runtime.isProjectMemoryEnabled()).toBe(false);
      const configResult = resolveRuntimeConfig.mock.calls.at(-1)?.[0].configResult;
      const config = configResult.config;
      expect(config.skills.enabled).toBe(true);
      expect(config.mcp.servers["extra-only"]).toBeUndefined();
      expect(JSON.stringify(config.hooks)).not.toContain("must-not-run");
      expect(configResult.sources.project.workspaceHookSnapshot?.hooks ?? []).toHaveLength(0);
      expect(config.plugins.dirs).not.toContain(join(extra, "extra-plugin"));
      expect(resolveRuntimeConfig.mock.calls.at(-1)?.[0].workingDirectory).toBe(main);
    });
  }, 30_000);

  it("workflow actor 使用同一目录列表发现技能，不另读附加目录配置", async () => {
    await withDirectoryApp(async ({ main, extra }) => {
      const port = createWorkflowChildSkillPort({
        appOptions: { additionalDirectories: [extra] } as never,
        configResult: createConfig({ workingDirectory: main, skipUserConfig: true, env: {} }),
        pluginSkillRoots: [],
      });
      const catalog = await port!.discoverSkills({ workingDirectory: main });
      expect(catalog.skills).toContainEqual(
        expect.objectContaining({ qualifiedName: `backend/${capabilityName}` }),
      );
    });
  }, 30_000);

  it("expert workflow 子运行时也保留附加目录的限定技能", async () => {
    await withDirectoryApp(async ({ app, requests }) => {
      await app.runExpertWorkflow({ task: "verify directory skills" });
      expect(requests[0]).toContain(`backend/${capabilityName}`);
      expect(requests[0]).toContain("extra-skill-marker");
      expect(requests[0]).not.toContain("extra-instructions-marker");
    });
  }, 30_000);

  it("真实 fork 继承父运行实例的目录范围，不按当前 Host 偏好重新配置", async () => {
    await withDirectoryApp(async ({ app, main, extra, store }) => {
      let child: ZCodeApp | undefined;
      const server = new ZCodeProtocolAgentServer({
        cwd: main,
        sessionStore: store,
        createZCodeApp: async (options) => {
          if (options?.sessionId === app.sessionId) return app;
          child = await createRegistryBackedTestApp({
            ...options,
            env: { ZCODE_STORAGE_DIR: join(main, "storage") },
            skipUserConfig: true,
            runtimeConfig: { ...options?.runtimeConfig, mcp: { enabled: false } },
          });
          return child;
        },
      });
      const request = async (id: string, method: string, params: unknown) => {
        const response = await server.handleMessage({ id, method, params });
        if (!response || !("result" in response)) throw new Error(JSON.stringify(response));
        return response.result;
      };
      try {
        await request("create", zcodeProtocolMethods.sessionCreate, {
          sessionId: app.sessionId,
          workspace: { workspaceKey: main, workspacePath: main },
          additionalDirectories: [extra],
        });
        await app.submitPrompt("seed a real fork");
        const messages = await store.messages({ sessionID: app.sessionId });
        const boundary = messages.findLast((message) => message.info.role === "assistant")!;
        await request("fork", zcodeProtocolMethods.sessionFork, {
          sessionId: app.sessionId,
          target: { kind: "message", messageId: boundary.info.id },
        });
        const catalog = await child!.runtime.getSkillCatalog(
          createRootTraceContext({ sessionId: child!.sessionId }),
        );
        expect(catalog.skills).toContainEqual(
          expect.objectContaining({ qualifiedName: `backend/${capabilityName}` }),
        );
      } finally {
        await server.shutdown();
        server.disposeProjections();
        await child?.close?.();
      }
    });
  }, 30_000);

  it.each(["create", "resume", "desktop-continuous", "web-remote-replayable"] as const)(
    "%s 通过真实协议和 App 装配消费目录列表，重复订阅不重配",
    async (operation) => {
      await withDirectoryApp(async ({ app, main, extra, store }) => {
        if (operation !== "create") await app.submitPrompt("persist directory history");
        await app.close?.();
        const materialized: ZCodeApp[] = [];
        const server = new ZCodeProtocolAgentServer({
          cwd: main,
          sessionStore: store,
          createZCodeApp: async (options) => {
            const resumed = await createRegistryBackedTestApp({
              ...options,
              env: { ZCODE_STORAGE_DIR: join(main, "storage") },
              skipUserConfig: true,
              runtimeConfig: { ...options?.runtimeConfig, mcp: { enabled: false } },
            });
            materialized.push(resumed);
            return resumed;
          },
        });
        const workspace = { workspaceKey: main, workspacePath: main };
        const request = async (message: ZCodeProtocolMessage) => {
          const response = await server.handleMessage(message);
          if (!response || !("result" in response)) throw new Error(JSON.stringify(response));
          return response.result;
        };
        const subscribe = (additionalDirectories: string[]) =>
          request({
            id: "subscribe",
            method: V4_METHODS.conversationSubscribe,
            params: {
              topic: conversationTopic(app.sessionId),
              connectionId: "directory-connection",
              clientMode: operation === "web-remote-replayable" ? operation : "desktop-continuous",
              workspace,
              additionalDirectories,
            },
          });
        try {
          if (operation === "create" || operation === "resume") {
            await request({
              id: operation,
              method:
                operation === "create"
                  ? zcodeProtocolMethods.sessionCreate
                  : zcodeProtocolMethods.sessionResume,
              params: { sessionId: app.sessionId, workspace, additionalDirectories: [extra] },
            });
          } else {
            await subscribe([extra]);
            await expect(store.getSession(app.sessionId)).resolves.toMatchObject({
              directory: main,
            });
            expect(
              (await store.messages({ sessionID: app.sessionId })).some((message) =>
                message.parts.some(
                  (part) => part.type === "text" && part.text === "persist directory history",
                ),
              ),
            ).toBe(true);
          }
          expect(materialized).toHaveLength(1);
          const restored = materialized[0]!;
          const catalog = await restored.runtime.getSkillCatalog(
            createRootTraceContext({ sessionId: restored.sessionId }),
          );
          expect(catalog.skills).toContainEqual(
            expect.objectContaining({ qualifiedName: `backend/${capabilityName}` }),
          );
          await subscribe([join(extra, "must-not-reconfigure")]);
          expect(materialized).toHaveLength(1);
          const unchanged = await restored.runtime.getSkillCatalog(
            createRootTraceContext({ sessionId: restored.sessionId }),
          );
          expect(unchanged.skills).toEqual(catalog.skills);
        } finally {
          await server.shutdown();
          server.disposeProjections();
          for (const restored of materialized) await restored.close?.();
        }
      });
    },
    30_000,
  );
});

describe("App 初始化旧 Subagent 身份", () => {
  // 真实文件迁移与 App 初始化在高负载下可能超过默认 5 秒，保留全部迁移顺序断言。
  it("用户目录完成原地迁移再构造 Runtime；项目文件不迁移也不暗中换身份", async () => {
    const root = await mkdtemp(join(tmpdir(), "zcode-subagent-init-"));
    const directory = join(root, ".zcode", "agents");
    const file = join(directory, "legacy.md");
    const markdown =
      "---\nname: legacy\ndescription: legacy profile\nmodel: builtin:zai-coding-plan/glm-4.6\nthoughtLevel: high\n---\nreview";
    const store = await createSqliteSessionStore({ dbPath: ":memory:" });
    let app: ZCodeApp | undefined;
    let creation: Promise<ZCodeApp> | undefined;
    try {
      await mkdir(directory, { recursive: true });
      await writeFile(file, markdown);
      const userRoot = join(root, "storage", "agents");
      await mkdir(userRoot, { recursive: true });
      await writeFile(
        join(userRoot, "user.md"),
        markdown.replace("name: legacy", "name: user-legacy"),
      );
      await mkdir(join(root, "storage", "v2"), { recursive: true });
      const stateFile = join(root, "storage", "v2", "agents-state.json");
      await writeFile(
        stateFile,
        JSON.stringify({
          builtInModelOverrides: { Explore: "builtin:zai-coding-plan/glm-4.6" },
          builtInThoughtLevelOverrides: { Explore: "high" },
        }),
      );
      resolveRuntimeConfig.mockClear();
      creation = Promise.resolve(
        createRegistryBackedTestApp({
          env: { ZCODE_STORAGE_DIR: join(root, "storage") },
          skipUserConfig: true,
          sessionStore: store,
          runtimeConfig: { workingDirectory: root, mcp: { enabled: false } },
        }),
      );
      app = await creation;
      // 用户配置迁移同时规范账户模型 ID 的大小写，项目文档仍保持原字节。
      expect(resolveRuntimeConfig.mock.calls[0]?.[0].subagentProfiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "user-legacy",
            modelSelection: {
              providerId: "account:zai-individual-coding-plan",
              modelId: "GLM-4.6",
              options: { reasoningLevel: "high" },
            },
          }),
        ]),
      );
      expect(resolveRuntimeConfig.mock.calls[0]?.[0].subagentProfiles).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "legacy",
            modelSelection: {
              providerId: "builtin:zai-coding-plan",
              modelId: "glm-4.6",
              options: { reasoningLevel: "high" },
            },
          }),
        ]),
      );
      expect(await readFile(join(userRoot, "user.md"), "utf8")).toBe(
        markdown
          .replace("name: legacy", "name: user-legacy")
          .replace(
            "model: builtin:zai-coding-plan/glm-4.6",
            "model: account:zai-individual-coding-plan/GLM-4.6",
          ),
      );
      expect(await readFile(file, "utf8")).toBe(markdown);
      expect(
        JSON.parse(await readFile(stateFile, "utf8")).builtInModelSelectionOverrides.Explore,
      ).toEqual({
        providerId: "account:zai-individual-coding-plan",
        modelId: "GLM-4.6",
        options: { reasoningLevel: "high" },
      });
    } finally {
      app ??= await creation;
      await app?.close?.();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  }, 30_000);
});
