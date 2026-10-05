import { assertOfficialServiceRemoved } from "@zcode/shared";
import { randomBytes } from "node:crypto";
import type { HttpClientPort, HttpClientRunOptions, TraceContext } from "@zcode/contracts";

const DEFAULT_ZCODE_OAUTH_BASE_URL = "";
export type CliOAuthProviderId = "zai" | "bigmodel";
const POLL_TOKEN_BYTES = 32;
const JSON_CONTENT_TYPE = "application/json";

export interface CliOAuthClientOptions {
  baseUrl?: string;
  providerId: CliOAuthProviderId;
  httpClient: HttpClientPort;
  trace?: TraceContext;
}

export interface CliOAuthInitInput {
  pollToken: string;
}

export interface CliOAuthInitData {
  authorize_url: string;
  expires_at: number;
  flow_id: string;
  poll_interval_sec: number;
}

export interface CliOAuthPollInput {
  flowId: string;
  pollToken: string;
}

export interface CliOAuthUser {
  avatar?: string;
  email?: string;
  name?: string;
  user_id: string;
}

export interface CliOAuthReadyData {
  status: "ready";
  token: string;
  user: CliOAuthUser;
  providerId: CliOAuthProviderId;
  accessToken: string;
  refreshToken?: string;
}

export interface CliOAuthPendingData {
  status: "pending";
}

export interface CliOAuthFailedData {
  status: "failed";
}

export type CliOAuthPollData = CliOAuthFailedData | CliOAuthPendingData | CliOAuthReadyData;

export interface CliOAuthClient {
  init(input: CliOAuthInitInput, options?: HttpClientRunOptions): Promise<CliOAuthInitData>;
  poll(input: CliOAuthPollInput, options?: HttpClientRunOptions): Promise<CliOAuthPollData>;
}

export class CliOAuthError extends Error {
  readonly businessCode?: number;
  readonly httpStatus?: number;

  constructor(message: string, details: { businessCode?: number; httpStatus?: number } = {}) {
    super(message);
    this.name = "CliOAuthError";
    this.businessCode = details.businessCode;
    this.httpStatus = details.httpStatus;
  }
}

export function createCliOAuthClient(options: CliOAuthClientOptions): CliOAuthClient {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? DEFAULT_ZCODE_OAUTH_BASE_URL);
  const encoder = new TextEncoder();

  return {
    async init(
      input: CliOAuthInitInput,
      runOptions?: HttpClientRunOptions,
    ): Promise<CliOAuthInitData> {
    // 审计版不连接官方服务：必须在凭证读取与网络请求前短路。
    assertOfficialServiceRemoved("account");

      const envelope = await requestJsonEnvelope(
        options.httpClient,
        {
          body: encoder.encode(JSON.stringify({ provider: options.providerId })),
          headers: {
            Authorization: `Bearer ${input.pollToken}`,
            "Content-Type": JSON_CONTENT_TYPE,
          },
          method: "POST",
          trace: options.trace,
          url: `${baseUrl}/oauth/cli/init`,
        },
        runOptions,
      );
      return parseInitData(envelope.data);
    },

    async poll(
      input: CliOAuthPollInput,
      runOptions?: HttpClientRunOptions,
    ): Promise<CliOAuthPollData> {
    // 审计版不连接官方服务：必须在凭证读取与网络请求前短路。
    assertOfficialServiceRemoved("account");

      const flowId = encodeURIComponent(input.flowId);
      const envelope = await requestJsonEnvelope(
        options.httpClient,
        {
          headers: {
            Authorization: `Bearer ${input.pollToken}`,
          },
          method: "GET",
          trace: options.trace,
          url: `${baseUrl}/oauth/cli/poll/${flowId}`,
        },
        runOptions,
      );
      return parsePollData(envelope.data, options.providerId);
    },
  };
}

export function createCliOAuthPollToken(): string {
  return randomBytes(POLL_TOKEN_BYTES).toString("hex");
}

function normalizeBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/+$/u, "");
}

async function requestJsonEnvelope(
  httpClient: HttpClientPort,
  request: Parameters<HttpClientPort["request"]>[0],
  options?: HttpClientRunOptions,
): Promise<{ code: number; data?: unknown; msg?: string }> {
  const response = await httpClient.request(
    {
      maxResponseBytes: 64 * 1024,
      ...request,
    },
    options,
  );
  if (response.status < 200 || response.status >= 300) {
    throw new CliOAuthError(`OAuth HTTP error ${response.status}`, {
      httpStatus: response.status,
    });
  }
  const bodyText = new TextDecoder().decode(response.body);
  const parsed = parseJson(bodyText);
  const envelope = asRecord(parsed);
  if (!envelope || typeof envelope.code !== "number") {
    throw new CliOAuthError("Invalid OAuth response envelope", {
      httpStatus: response.status,
    });
  }

  const responseMessage = typeof envelope.msg === "string" ? envelope.msg : undefined;
  if (envelope.code !== 0) {
    throw new CliOAuthError(responseMessage ?? `OAuth business error ${envelope.code}`, {
      businessCode: envelope.code,
      httpStatus: response.status,
    });
  }

  return {
    code: envelope.code,
    data: envelope.data,
    msg: responseMessage,
  };
}

function parseInitData(value: unknown): CliOAuthInitData {
  const data = asRecord(value);
  if (
    !data ||
    !readString(data.flow_id) ||
    !readString(data.authorize_url) ||
    typeof data.expires_at !== "number" ||
    !Number.isFinite(data.expires_at) ||
    typeof data.poll_interval_sec !== "number" ||
    !Number.isFinite(data.poll_interval_sec) ||
    data.poll_interval_sec < 1
  ) {
    throw new CliOAuthError("Invalid OAuth init response data");
  }
  try {
    if (new URL(readString(data.authorize_url)!).protocol !== "https:") throw new Error();
  } catch {
    throw new CliOAuthError("Invalid OAuth authorization URL");
  }

  return {
    authorize_url: readString(data.authorize_url)!,
    expires_at: data.expires_at,
    flow_id: readString(data.flow_id)!,
    poll_interval_sec: data.poll_interval_sec,
  };
}

function parsePollData(value: unknown, providerId: CliOAuthProviderId): CliOAuthPollData {
  const data = asRecord(value);
  const status = data?.status;
  if (status === "pending" || status === "failed") {
    return { status };
  }

  if (status === "ready" && data) {
    return parseReadyData(data, providerId);
  }

  throw new CliOAuthError("Invalid OAuth poll response data");
}

function parseReadyData(
  data: Record<string, unknown>,
  providerId: CliOAuthProviderId,
): CliOAuthReadyData {
  const user = asRecord(data.user);
  const provider = asRecord(data[providerId]);
  const accessToken = readString(provider?.access_token) ?? readString(provider?.accessToken);
  const refreshToken = readString(provider?.refresh_token) ?? readString(provider?.refreshToken);
  if (!readString(data.token) || !user || !readString(user.user_id) || !accessToken) {
    throw new CliOAuthError("Invalid OAuth ready response data");
  }

  return {
    status: "ready",
    token: readString(data.token)!,
    user: {
      ...(typeof user.avatar === "string" ? { avatar: user.avatar } : {}),
      ...(typeof user.email === "string" ? { email: user.email } : {}),
      ...(typeof user.name === "string" ? { name: user.name } : {}),
      user_id: readString(user.user_id)!,
    },
    providerId,
    accessToken,
    ...(refreshToken ? { refreshToken } : {}),
  };
}

function parseJson(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    throw new CliOAuthError("OAuth response is not valid JSON", {
      httpStatus: undefined,
    });
  }
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function readString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}
