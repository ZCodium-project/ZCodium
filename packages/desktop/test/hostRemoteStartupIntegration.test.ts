import { runStartupReconnectBatch } from "../src/host/sourceServerStartupReconnect.js";
import { connectSourceServerTarget } from "../src/host/connectSourceServerTarget.js";
import { readFile } from "node:fs/promises";
import { runInNewContext } from "node:vm";
import ts from "typescript";
import { describe, expect, it, vi } from "vitest";

/** Host 入口依赖 Electron utilityProcess；执行真实函数体，平台与连接端口在本边界注入。 */
async function loadHostSource() {
  const file = new URL("../src/host/index.ts", import.meta.url);
  return ts.createSourceFile(
    file.pathname,
    await readFile(file, "utf8"),
    ts.ScriptTarget.Latest,
    true,
  );
}

function compile(source: string) {
  return ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } })
    .outputText;
}

interface RemoteServices {
  generation: number;
  clientConfig?: object;
}
interface ReconnectEvent {
  sourceServerId: string;
  serverInfo: { serverId: string; capabilities: { processResourceTelemetry?: boolean } };
  services: RemoteServices;
}
interface RemoteHandle {
  services: RemoteServices;
  onDidReconnect(listener: () => void): void;
  dispose(): Promise<void>;
}

describe("Window Host 的 Source 重连与数据库启动整合", () => {
  it("数据库准备前不创建业务服务；Source 初始化保留但后台迁移不阻塞 base attachment 和 ready", async () => {
    const source = await loadHostSource();
    let initNode: ts.IfStatement | undefined;
    function findInit(node: ts.Node): void {
      if (
        ts.isIfStatement(node) &&
        node.expression.getText(source) === "msg.type === HostMessageTypes.InitLocal"
      ) {
        initNode = node;
      } else {
        ts.forEachChild(node, findInit);
      }
    }
    findInit(source);
    if (!initNode) throw new Error("Host InitLocal handler is missing");
    const events: string[] = [];
    const { promise: prepared, resolve: finishPreparation } = Promise.withResolvers<void>();
    const services = {
      getOptional: () => undefined,
      get: () => ({ get: async () => ({ remoteStartupAutoReconnectEnabled: false }) }),
      register() {
        return this;
      },
    };
    const createLocalServices = vi.fn((params: { resolveBotProjectConnection: unknown }) => {
      events.push("local-services");
      expect(params.resolveBotProjectConnection).toBeTypeOf("function");
      return services;
    });
    const run = runInNewContext(
      `${compile(`async function run() { ${initNode.getText(source)} }`)};run;`,
      {
        databaseStartup: undefined,
        activeSessionRealtimePort: null,
        activeServices: null,
        activeHostApiNetworkTransport: null,
        sourceServerDirectory: null,
        sourceServerArtifactPolicy: null,
        sourceServerConnectionManager: null,
        sourceServerManagementService: null,
        sourceSettingsStateSubscription: null,
        hasDisposedHostResources: false,
        disposeHostResourcesInFlight: null,
        msg: { type: "init-local", remoteAssets: {} },
        HostMessageTypes: { InitLocal: "init-local" },
        HostResponseTypes: { DatabaseStartupState: "db-state" },
        port: { once() {}, close() {} },
        logger: { info() {}, warn() {}, error() {} },
        pendingStartupAttachments: new Map(),
        parentPort: {
          postMessage: (message: { state: { phase: string } }) => events.push(message.state.phase),
        },
        process,
        createHostDatabaseStartup: (options: {
          initializeServices(): Promise<void>;
          publish(state: { phase: string }): void;
        }) => ({
          coordinator: {
            start: async () => {
              events.push("prepare");
              await prepared;
              await options.initializeServices();
              options.publish({ phase: "ready" });
            },
          },
        }),
        createTaskRealtimeBridgeForHostInit: () => null,
        createE2ERepoWikiGenerationFixtureFromEnv: () => undefined,
        createSettingServiceWithMigrations: () => ({
          service: {},
          prepareLegacyAccountConnections() {},
        }),
        createHostApiNetworkTransport: () => ({ fetch() {} }),
        initializeHostApiNetworkTransportOwner: async (params: { establishOwner(): unknown }) =>
          params.establishOwner(),
        createLocalServices,
        resolveBotProjectConnection() {},
        authorizeLocalMediaPreviewPath() {},
        runtimeProcessLifecycleReporter: {},
        runtimeTaskReporter: {},
        repoWikiTaskReporter: {},
        createFullFeedbackLogArchiveViaMain() {},
        dispatchManualAutomationRun() {},
        browserControlMainBridge: {},
        cuaOperationStateReporter: {},
        pluginSandboxRegistrationBridge: { register() {} },
        IZCodeTaskService: {},
        ISettingService: {},
        ICredentialService: {},
        ISourceServerManagementService: {},
        IRemoteProjectService: {},
        createRemoteProjectConnectionAdmission: () => async () => {},
        notifyProjectChange() {},
        runStartupReconnectBatch,
        SourceServerDirectory: class {
          constructor() {
            events.push("source-directory");
          }
          initialize() {
            events.push("source-background");
            return new Promise(() => {});
          }
        },
        SourceServerConnectionManager: class {
          constructor() {
            events.push("source-manager");
          }
          onDidChangeState() {
            return { dispose() {} };
          }
        },
        createSourceServerManagementService: () => ({}),
        wireLocalResourceTelemetry() {
          events.push("local-telemetry");
        },
        windowHostAttachmentRegistry: {
          attach() {
            events.push("base-attachment");
          },
        },
        randomUUID: () => "id",
        logWindowHostTopology() {},
      },
    ) as () => Promise<void>;
    const complete = run();
    expect(createLocalServices).not.toHaveBeenCalled();
    expect(events).toEqual(["prepare"]);
    finishPreparation();
    await complete;
    expect(createLocalServices).toHaveBeenCalledOnce();
    expect(events).toEqual([
      "prepare",
      "local-services",
      "source-directory",
      "source-manager",
      "base-attachment",
      "source-background",
      "ready",
    ]);
  });
});
