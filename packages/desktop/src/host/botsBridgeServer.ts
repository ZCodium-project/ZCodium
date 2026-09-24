/* oxlint-disable eslint(max-lines) -- 桥接传输层集中维护：握手、鉴权、帧路由。 */
// AstrBot 桥接的本机 loopback WebSocket 服务 v2。见 .agents/specs/bots-astrbot-bridge.md。
//
// 边界：只监听 127.0.0.1，只做帧路由与鉴权；业务状态由官方 BotsService 持有。
// v2.1：输入帧交给 IBotsService.handleProviderCallback("astrbot", ...)，输出帧由
// astrbotProvider 经 `handle.transport` 广播（provider.send / status）。

import { randomUUID, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server } from "node:http";
import {
  BOTS_BRIDGE_PATH,
  BOTS_BRIDGE_PROTOCOL_VERSION,
  safeParseBotsBridgeClientFrame,
  type BotsBridgeCommandFrame,
  type BotsBridgeDeliveryFrame,
  type BotsBridgeResumeCursor,
  type BotsBridgeServerFrame,
} from "@zcode/shared";
import {
  createServiceLogger,
  type AstrBotBridgeTransport,
  type BotsDeliveryReplay,
  type ServiceLogger,
} from "@zcode/services/node";
import { WebSocket, WebSocketServer, type RawData } from "ws";

/** 传输层最小依赖面：由 host 用 IBotsService + astrbotProvider 适配。 */
export interface BotsBridgeServicePort {
  /** AstrBot bot 是否启用（welcome 帧）。 */
  isEnabled(): Promise<boolean>;
  /** 可用于绑定的 workspace 数量（welcome 帧）。 */
  getWorkspaceCount(): Promise<number>;
  /** 受理一条命令帧：provider.beginTurn → 官方处理 → provider.settleTurn。 */
  handleCommand(frame: BotsBridgeCommandFrame): Promise<void>;
  ackDeliveryByFrameId(deliveryId: string): void;
  resolveResume(cursors: readonly BotsBridgeResumeCursor[]): Map<string, BotsDeliveryReplay>;
  buildSnapshot(bindingId: string): Promise<BotsBridgeDeliveryFrame | null>;
}

export interface BotsBridgeServerOptions {
  service: BotsBridgeServicePort;
  /** 用户填到 AstrBot 插件里的桥接 token；必须非空。 */
  token: string;
  logger?: ServiceLogger;
  host?: string;
  port?: number;
  path?: string;
  serverVersion?: string;
}

export interface BotsBridgeServerHandle {
  readonly url: string;
  readonly port: number;
  /** provider 通过它向所有已连接会话广播出站帧。 */
  readonly transport: AstrBotBridgeTransport;
  close(): Promise<void>;
}

interface ClientSession {
  socket: WebSocket;
  clientId: string;
  channels: string[];
}

function safeTokenEquals(expected: string, provided: string): boolean {
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided, "utf8");
  if (a.length !== b.length) {
    return false;
  }
  return timingSafeEqual(a, b);
}

function readBearerToken(header: string | string[] | undefined): string | null {
  const value = Array.isArray(header) ? header[0] : header;
  if (!value) {
    return null;
  }
  const match = /^Bearer\s+(.+)$/iu.exec(value.trim());
  return match?.[1]?.trim() || null;
}

function parseJsonFrame(raw: RawData): unknown {
  try {
    return JSON.parse(raw.toString("utf8"));
  } catch {
    return undefined;
  }
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * 启动桥接服务并返回监听地址。
 * `port: 0` 时由系统分配临时端口，调用方负责把 `url` 暴露给用户/插件。
 */
export async function startBotsBridgeServer(
  options: BotsBridgeServerOptions,
): Promise<BotsBridgeServerHandle> {
  const logger = options.logger ?? createServiceLogger("bots.bridge");
  const token = options.token.trim();
  if (!token) {
    throw new Error("Bots bridge token is required.");
  }
  const path = options.path ?? BOTS_BRIDGE_PATH;
  const host = options.host ?? "127.0.0.1";
  const sessions = new Set<ClientSession>();
  const server: Server = createServer((_req, res) => {
    res.statusCode = 404;
    res.end();
  });
  const wss = new WebSocketServer({ noServer: true, maxPayload: 1024 * 1024 });

  server.on("upgrade", (req: IncomingMessage, socket, head) => {
    const pathname = new URL(req.url ?? "/", "http://127.0.0.1").pathname;
    if (pathname !== path) {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }
    const provided = readBearerToken(req.headers.authorization);
    if (!provided || !safeTokenEquals(token, provided)) {
      logger.warn(undefined, "bots bridge handshake rejected: invalid token");
      socket.write("HTTP/1.1 401 Unauthorized\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit("connection", ws, req);
    });
  });

  const send = (session: ClientSession, frame: BotsBridgeServerFrame): void => {
    if (session.socket.readyState === WebSocket.OPEN) {
      session.socket.send(JSON.stringify(frame));
    }
  };

  const broadcast = (frame: BotsBridgeServerFrame): void => {
    for (const session of sessions) {
      send(session, frame);
    }
  };

  const resumeSession = async (
    session: ClientSession,
    cursors: readonly BotsBridgeResumeCursor[],
  ): Promise<void> => {
    const resolved = options.service.resolveResume(cursors);
    for (const cursor of cursors) {
      const replay = resolved.get(cursor.bindingId);
      if (!replay) {
        continue;
      }
      if (replay.needsSnapshot) {
        const snapshot = await options.service.buildSnapshot(cursor.bindingId);
        if (snapshot) {
          send(session, snapshot);
        }
        continue;
      }
      for (const frame of replay.frames) {
        send(session, frame);
      }
    }
  };

  const handleFrame = async (session: ClientSession, frame: unknown): Promise<void> => {
    const parsed = safeParseBotsBridgeClientFrame(frame);
    if (!parsed.success) {
      send(session, {
        v: BOTS_BRIDGE_PROTOCOL_VERSION,
        kind: "error",
        id: randomUUID(),
        code: "INVALID_FRAME",
        message: "Bridge frame failed validation.",
      });
      return;
    }
    const clientFrame = parsed.data;
    switch (clientFrame.kind) {
      case "hello": {
        session.clientId = clientFrame.clientId;
        session.channels = clientFrame.channels;
        const [enabled, workspaceCount] = await Promise.all([
          options.service.isEnabled(),
          options.service.getWorkspaceCount(),
        ]);
        send(session, {
          v: BOTS_BRIDGE_PROTOCOL_VERSION,
          kind: "welcome",
          id: randomUUID(),
          inReplyTo: clientFrame.id,
          ...(options.serverVersion ? { serverVersion: options.serverVersion } : {}),
          enabled,
          workspaceCount,
        });
        await resumeSession(session, clientFrame.resume ?? []);
        return;
      }
      case "command": {
        await options.service.handleCommand(clientFrame);
        return;
      }
      case "ack": {
        // ack 帧只带 inReplyTo（delivery id），服务侧反查绑定并推进游标。
        options.service.ackDeliveryByFrameId(clientFrame.inReplyTo);
        return;
      }
      case "error": {
        logger.warn(
          undefined,
          `bots bridge client error code=${clientFrame.code}: ${clientFrame.message}`,
        );
        return;
      }
      default:
        return;
    }
  };

  wss.on("connection", (ws: WebSocket) => {
    const session: ClientSession = { socket: ws, clientId: "", channels: [] };
    sessions.add(session);
    ws.on("message", (raw: RawData) => {
      void handleFrame(session, parseJsonFrame(raw)).catch((error: unknown) => {
        logger.warn(undefined, `bots bridge frame handling failed: ${formatError(error)}`);
      });
    });
    ws.on("close", () => sessions.delete(session));
    ws.on("error", (error: Error) => {
      logger.debug(undefined, `bots bridge socket error: ${error.message}`);
    });
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, host, () => {
      const address = server.address();
      if (address && typeof address === "object") {
        resolve(address.port);
      } else {
        reject(new Error("Bots bridge server did not bind a TCP port."));
      }
    });
  });

  const url = `ws://${host}:${port}${path}`;
  logger.info(undefined, `bots bridge listening on ${url}`);

  return {
    url,
    port,
    transport: { send: broadcast },
    async close(): Promise<void> {
      for (const session of sessions) {
        session.socket.close();
      }
      sessions.clear();
      await new Promise<void>((resolve) => wss.close(() => resolve()));
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}