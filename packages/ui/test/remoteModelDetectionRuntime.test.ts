// @vitest-environment jsdom

import { createServer, type IncomingHttpHeaders } from "node:http";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  TID_MODEL_PROVIDER_ADD_MODEL_BUTTON,
  TID_MODEL_PROVIDER_API_KEY_INPUT,
  TID_MODEL_PROVIDER_BASE_URL_INPUT,
  TID_MODEL_PROVIDER_DETECT_MODELS_BUTTON,
} from "@zcode/shared";
import type { IProviderSettingsService } from "@zcode/services";
import { createProviderRuntime } from "../../services/src/model-provider/providerRuntime.js";
import type { ProviderSettingsFormProvider } from "@/lib/providerSettingsFormTypes.js";
import { InlineEditableProviderCard } from "@/settings/model-provider-section/InlineEditableProviderCard.js";

const service = vi.hoisted(() => ({ current: null as IProviderSettingsService | null }));
vi.mock("@/hooks/useServices.js", () => ({
  useServices: () => ({ providerSettingsService: service.current }),
}));
vi.mock("@/hooks/usePlatform.js", () => ({ usePlatform: () => ({ openExternal: vi.fn() }) }));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "zh-CN",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

afterEach(cleanup);

it("设置草稿 → 生产 Runtime → 真实本地 HTTP → UI 点选/失败，检测不写配置", async () => {
  const requests: { url: string; headers: IncomingHttpHeaders }[] = [];
  const server = createServer((request, response) => {
    requests.push({ url: request.url!, headers: request.headers });
    response.setHeader("content-type", "application/json");
    response.statusCode = request.url!.startsWith("/denied/")
      ? 401
      : request.url!.startsWith("/missing/")
        ? 404
        : 200;
    response.end(JSON.stringify({ data: [{ id: "fixture-model" }] }));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  const root = await mkdtemp(join(tmpdir(), "zcode-ui-model-detection-"));
  const runtime = createProviderRuntime({
    zcodeBuiltinFilePath: join(root, "never-written-builtin.json"),
    personalFilePath: join(root, "never-written-personal.json"),
    watch: false,
  });
  service.current = runtime.providerSettings;
  const start = vi.spyOn(runtime, "start");
  const snapshot = runtime.registryService.getSnapshot();
  const onSave = vi.fn();
  const onAddPersonalModel = vi.fn();
  const config = {
    group: "standard-personal" as const,
    access: { type: "api-key" as const, apiKey: "fixture-initial-key" },
    api: {
      type: "openai-chat-completions" as const,
      baseUrl: `${base}/initial/v1`,
      headers: { "X-Fixture": "fixture-explicit-header" },
    },
  };
  const provider: ProviderSettingsFormProvider = {
    providerId: "fixture-provider",
    enabled: true,
    executable: false,
    hasPersonalConfig: true,
    personalConfig: config,
    config,
    models: [],
  };
  try {
    const view = render(
      createElement(InlineEditableProviderCard, {
        provider,
        onSave,
        onAddPersonalModel,
      }),
    );
    fireEvent.change(screen.getByTestId(TID_MODEL_PROVIDER_BASE_URL_INPUT), {
      target: { value: `${base}/draft/v1` },
    });
    fireEvent.change(screen.getByTestId(TID_MODEL_PROVIDER_API_KEY_INPUT), {
      target: { value: "fixture-draft-key" },
    });
    fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_ADD_MODEL_BUTTON));
    fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_DETECT_MODELS_BUTTON));
    expect(
      (screen.getByTestId(TID_MODEL_PROVIDER_DETECT_MODELS_BUTTON) as HTMLButtonElement).disabled,
    ).toBe(true);
    fireEvent.click(await screen.findByRole("button", { name: "fixture-model" }));
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      url: "/draft/v1/models",
      headers: {
        authorization: "Bearer fixture-draft-key",
        "x-fixture": "fixture-explicit-header",
      },
    });
    expect(
      view.container.ownerDocument.querySelector('input[value="fixture-model"]'),
    ).not.toBeNull();
    expect(onSave).not.toHaveBeenCalled();
    expect(onAddPersonalModel).not.toHaveBeenCalled();

    // 重开弹窗后仍用最新草稿地址，实际 HTTP 错误必须回到 UI，不能被“未装配”掩盖。
    for (const [path, status] of [
      ["denied", "401"],
      ["missing", "404"],
    ]) {
      fireEvent.click(screen.getByRole("button", { name: "common.cancel" }));
      fireEvent.change(screen.getByTestId(TID_MODEL_PROVIDER_BASE_URL_INPUT), {
        target: { value: `${base}/${path}/v1` },
      });
      fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_ADD_MODEL_BUTTON));
      fireEvent.click(screen.getByTestId(TID_MODEL_PROVIDER_DETECT_MODELS_BUTTON));
      expect((await screen.findByRole("alert")).textContent).toContain(status);
      expect(screen.getByRole("alert").textContent).not.toContain("fixture-draft-key");
      expect(requests.at(-1)?.url).toBe(`/${path}/v1/models`);
    }
    const explicit = await runtime.providerSettings.listRemoteModels({
      apiType: "anthropic-messages",
      baseUrl: `${base}/anthropic`,
      apiKey: "fixture-draft-key",
      headers: { authorization: "Bearer fixture-header-key" },
    });
    expect(explicit).toMatchObject({ success: true, models: ["fixture-model"] });
    expect(requests.at(-1)).toMatchObject({
      url: "/anthropic/v1/models?limit=1000",
      headers: {
        authorization: "Bearer fixture-header-key",
        "x-api-key": "fixture-draft-key",
        "anthropic-version": "2023-06-01",
      },
    });
    expect(start).not.toHaveBeenCalled();
    expect(runtime.registryService.getSnapshot()).toBe(snapshot);
    await waitFor(async () => expect(await readdir(root)).toEqual([]));
  } finally {
    // unmount 原有 Provider 自动保存 cleanup 不属于模型检测；回调仅 spy，不接真实持久层。
    cleanup();
    runtime.dispose();
    service.current = null;
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
    await rm(root, { recursive: true, force: true });
  }
});
