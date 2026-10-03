import { assertOfficialServiceRemoved } from "@zcode/shared";
import type { HttpClientPort, HttpClientRunOptions, TraceContext } from "@zcode/contracts";
import { resolveBigModelApiOrigin } from "@zcode/shared";

const ZAI_API_HOST = "https://api.z.ai";
const JSON_CONTENT_TYPE = "application/json";
const ZCODE_API_KEY_NAME = "zcode-api-key";
const DEFAULT_ORG_NAME = "默认机构";
const DEFAULT_PROJECT_NAME = "默认项目";

export type CodingPlanFamily = "bigmodel" | "zai";

export interface CodingPlanApiKeyResolverOptions {
  httpClient: HttpClientPort;
  trace?: TraceContext;
}

export interface ResolveCodingPlanApiKeyInput {
  accessToken: string;
  family: CodingPlanFamily;
}

export interface CodingPlanApiKeyResolver {
  resolve(input: ResolveCodingPlanApiKeyInput, options?: HttpClientRunOptions): Promise<string>;
}

export class CodingPlanApiKeyError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "CodingPlanApiKeyError";
  }
}

interface RemoteEnvelope<T> {
  code?: number | string;
  data?: T;
  msg?: string;
}

interface RemoteProjectInfo {
  projectId?: string;
  projectName?: string;
}

interface RemoteOrganizationInfo {
  organizationId?: string;
  organizationName?: string;
  projects?: RemoteProjectInfo[];
}

interface RemoteCustomerInfo {
  organizations?: RemoteOrganizationInfo[];
}

interface RemoteApiKeySummary {
  apiKey?: string;
  name?: string;
}

interface RemoteApiKeySecret {
  secretKey?: string;
}

interface RemoteZaiBizToken {
  access_token?: string;
  accessToken?: string;
}

export function createCodingPlanApiKeyResolver(
  options: CodingPlanApiKeyResolverOptions,
): CodingPlanApiKeyResolver {
  return {
    async resolve(
      input: ResolveCodingPlanApiKeyInput,
      runOptions?: HttpClientRunOptions,
    ): Promise<string> {
    // 审计版不连接官方服务：必须在凭证读取与网络请求前短路。
    assertOfficialServiceRemoved("codingPlan");

      const accessToken = input.accessToken.trim();
      if (!accessToken) {
        throw new CodingPlanApiKeyError("OAuth access token is required.");
      }

      if (input.family === "bigmodel") {
        return resolveBizApiKey(
          {
            authorization: accessToken,
            host: resolveBigModelApiOrigin(process.env),
            httpClient: options.httpClient,
            trace: options.trace,
          },
          runOptions,
        );
      }

      const bizToken = await resolveZaiBizToken(options, accessToken, runOptions);
      return resolveBizApiKey(
        {
          authorization: `Bearer ${bizToken}`,
          host: ZAI_API_HOST,
          httpClient: options.httpClient,
          requireSecretKey: true,
          trace: options.trace,
        },
        runOptions,
      );
    },
  };
}

async function resolveZaiBizToken(
  options: CodingPlanApiKeyResolverOptions,
  oauthAccessToken: string,
  runOptions?: HttpClientRunOptions,
): Promise<string> {
  const payload = await requestRemoteData<RemoteZaiBizToken>(
    options.httpClient,
    {
      body: new TextEncoder().encode(JSON.stringify({ token: oauthAccessToken })),
      headers: {
        "Content-Type": JSON_CONTENT_TYPE,
      },
      method: "POST",
      trace: options.trace,
      url: `${ZAI_API_HOST}/api/auth/z/login`,
    },
    runOptions,
  );
  const token = payload?.access_token?.trim() ?? payload?.accessToken?.trim() ?? "";
  if (!token) {
    throw new CodingPlanApiKeyError("Z.AI biz token response is missing access_token.");
  }
  return token;
}

async function resolveBizApiKey(
  input: {
    authorization: string;
    host: string;
    httpClient: HttpClientPort;
    requireSecretKey?: boolean;
    trace?: TraceContext;
  },
  runOptions?: HttpClientRunOptions,
): Promise<string> {
  const customerInfo = await requestRemoteData<RemoteCustomerInfo>(
    input.httpClient,
    {
      headers: createBizAuthHeaders(input.authorization),
      method: "GET",
      trace: input.trace,
      url: `${input.host}/api/biz/customer/getCustomerInfo`,
    },
    runOptions,
  );
  const location = pickOrgAndProject(customerInfo);
  if (!location) {
    throw new CodingPlanApiKeyError("Unable to resolve organization and project.");
  }

  const listUrl =
    `${input.host}/api/biz/v1/organization/${location.organizationId}` +
    `/projects/${location.projectId}/api_keys`;
  const keys =
    (await requestRemoteData<RemoteApiKeySummary[]>(
      input.httpClient,
      {
        headers: createBizAuthHeaders(input.authorization),
        method: "GET",
        trace: input.trace,
        url: listUrl,
      },
      runOptions,
    )) ?? [];
  const keyEntry =
    keys.find((item) => item.name === ZCODE_API_KEY_NAME) ??
    (await requestRemoteData<RemoteApiKeySummary>(
      input.httpClient,
      {
        body: new TextEncoder().encode(JSON.stringify({ name: ZCODE_API_KEY_NAME })),
        headers: createBizAuthHeaders(input.authorization),
        method: "POST",
        trace: input.trace,
        url: listUrl,
      },
      runOptions,
    ));
  const apiKey = keyEntry?.apiKey?.trim() ?? "";
  if (!apiKey) {
    throw new CodingPlanApiKeyError("API key response is missing apiKey.");
  }

  const secret = await requestRemoteData<RemoteApiKeySecret>(
    input.httpClient,
    {
      headers: createBizAuthHeaders(input.authorization),
      method: "GET",
      trace: input.trace,
      url: `${listUrl}/copy/${encodeURIComponent(apiKey)}`,
    },
    runOptions,
  );
  const secretKey = secret?.secretKey?.trim() ?? "";
  if (!secretKey) {
    if (input.requireSecretKey) {
      throw new CodingPlanApiKeyError("API key copy response is missing secretKey.");
    }
    return apiKey;
  }

  return `${apiKey}.${secretKey}`;
}

async function requestRemoteData<T>(
  httpClient: HttpClientPort,
  request: Parameters<HttpClientPort["request"]>[0],
  options?: HttpClientRunOptions,
): Promise<T | null> {
  const response = await httpClient.request(
    {
      maxResponseBytes: 64 * 1024,
      ...request,
    },
    options,
  );
  const parsed = JSON.parse(new TextDecoder().decode(response.body)) as RemoteEnvelope<T>;
  if (!isSuccessfulRemoteCode(parsed.code)) {
    throw new CodingPlanApiKeyError(parsed.msg ?? `Remote business error ${parsed.code}`);
  }
  return parsed.data ?? null;
}

function createBizAuthHeaders(authorization: string): Record<string, string> {
  return {
    Authorization: authorization,
    "Content-Type": JSON_CONTENT_TYPE,
  };
}

function pickOrgAndProject(customerInfo: RemoteCustomerInfo | null): {
  organizationId: string;
  projectId: string;
} | null {
  const organizations = customerInfo?.organizations ?? [];
  const org =
    organizations.find((item) => item.organizationName?.includes(DEFAULT_ORG_NAME)) ??
    organizations[0];
  const projects = org?.projects ?? [];
  const project =
    projects.find((item) => item.projectName?.includes(DEFAULT_PROJECT_NAME)) ?? projects[0];
  if (!org?.organizationId || !project?.projectId) {
    return null;
  }
  return {
    organizationId: org.organizationId,
    projectId: project.projectId,
  };
}

function isSuccessfulRemoteCode(code: unknown): boolean {
  return (
    code === undefined ||
    code === null ||
    code === 0 ||
    code === 200 ||
    code === "0" ||
    code === "200"
  );
}
