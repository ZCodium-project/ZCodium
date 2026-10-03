import { assertOfficialServiceRemoved } from "@zcode/shared";
import { randomBytes } from "node:crypto";
import type { HttpClientPort, HttpClientRunOptions, TraceContext } from "@zcode/contracts";
import { buildBigModelApiUrl } from "@zcode/shared";

const BIGMODEL_AUTHORIZE_PATH = "/login";
const BIGMODEL_TOKEN_PATH = "/api/auth/tokenByAuthCode";
const BIGMODEL_APP_ID = "zcode";
const OAUTH_STATE_BYTES = 32;
const JSON_CONTENT_TYPE = "application/json";

export interface BigmodelOAuthClientOptions {
  appId?: string;
  appSecret?: string;
  authorizeUrl?: string;
  httpClient: HttpClientPort;
  tokenUrl?: string;
  trace?: TraceContext;
}

export interface BigmodelOAuthTokenSet {
  accessToken: string;
  refreshToken?: string;
}

export interface BigmodelOAuthClient {
  buildAuthorizeUrl(input: { redirectUri: string; state: string }): string;
  exchangeCode(input: { code: string }, options?: HttpClientRunOptions): Promise<BigmodelOAuthTokenSet>;
}

export class BigmodelOAuthError extends Error {
  constructor(message: string, options: { cause?: unknown } = {}) {
    super(message, options);
    this.name = "BigmodelOAuthError";
  }
}

interface BigmodelTokenEnvelope {
  data?: {
    accessToken?: string;
    refreshToken?: string;
  };
  msg?: string;
}

export function createBigmodelOAuthClient(
  options: BigmodelOAuthClientOptions,
): BigmodelOAuthClient {
  const appId = options.appId ?? BIGMODEL_APP_ID;
  const appSecret = options.appSecret?.trim() ?? "";
  const authorizeUrl =
    options.authorizeUrl ?? buildBigModelApiUrl(process.env, BIGMODEL_AUTHORIZE_PATH);
  const tokenUrl = options.tokenUrl ?? buildBigModelApiUrl(process.env, BIGMODEL_TOKEN_PATH);

  return {
    buildAuthorizeUrl(input: { redirectUri: string; state: string }): string {
      const query = new URLSearchParams({
        appId,
        redirect: input.redirectUri,
        state: input.state,
      });
      return `${authorizeUrl}?${query.toString()}`;
    },

    async exchangeCode(
      input: { code: string },
      runOptions?: HttpClientRunOptions,
    ): Promise<BigmodelOAuthTokenSet> {
    // 审计版不连接官方服务：必须在凭证读取与网络请求前短路。
    assertOfficialServiceRemoved("account");

      if (!appSecret) {
        throw new BigmodelOAuthError("BigModel OAuth appSecret is required.");
      }
      const response = await options.httpClient.request(
        {
          body: new TextEncoder().encode(
            JSON.stringify({
              appId,
              appSecret,
              authCode: input.code,
            }),
          ),
          headers: {
            "Content-Type": JSON_CONTENT_TYPE,
          },
          maxResponseBytes: 64 * 1024,
          method: "POST",
          trace: options.trace,
          url: tokenUrl,
        },
        runOptions,
      );
      const payload = JSON.parse(new TextDecoder().decode(response.body)) as BigmodelTokenEnvelope;
      const accessToken = payload.data?.accessToken?.trim() ?? "";
      if (!accessToken) {
        throw new BigmodelOAuthError(payload.msg ?? "BigModel token response is missing accessToken.");
      }
      return {
        accessToken,
        ...(payload.data?.refreshToken ? { refreshToken: payload.data.refreshToken } : {}),
      };
    },
  };
}

export function createBigmodelOAuthState(): string {
  return randomBytes(OAUTH_STATE_BYTES).toString("hex");
}
