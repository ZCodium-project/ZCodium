import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type {
  ConnectionProfile,
  SourceServerManagementSnapshot,
  SourceServerRecord,
} from "./contract.js";
import type { DeviceCardActions } from "./SourceServerDeviceCard.js";

const { buttons } = vi.hoisted(() => ({
  buttons: [] as Array<{ children?: ReactNode; disabled?: boolean; onClick?: () => void }>,
}));
vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children, ...props }: { children?: ReactNode }) => {
    buttons.push({ ...props, children });
    return createElement("button", props, children);
  },
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({
    locale: "en-US",
    intl: { formatMessage: ({ id }: { id: string }) => id },
  }),
}));

const source: SourceServerRecord = {
  sourceServerId: "owned-source",
  displayName: "My device",
  preferredProfileId: "preferred",
  installState: "installed",
  declaredWorkspaces: [],
};
const profile: ConnectionProfile = {
  profileId: "preferred",
  sourceServerId: source.sourceServerId,
  displayName: "Main route",
  transport: "ssh",
  target: { kind: "ssh", host: "example.test", username: "user", passwordCredentialKey: "saved" },
  lifecycleState: "active",
  createdAt: 1,
};
function snapshot(
  state: SourceServerManagementSnapshot["states"][number]["state"] = "offline",
): SourceServerManagementSnapshot {
  return {
    generation: 1,
    profiles: [profile],
    servers: [source],
    states: [
      { profileId: profile.profileId, sourceServerId: source.sourceServerId, state, updatedAt: 1 },
    ],
    workspaceHistory: [],
    migrationCounts: [],
    failedPathCount: 0,
    abandonedPathCount: 0,
  };
}
function actions(): DeviceCardActions {
  return {
    edit: vi.fn(),
    profileAction: vi.fn(),
    confirmIdentity: vi.fn(),
    removeProfile: vi.fn(),
    removeSource: vi.fn(),
    setPreferred: vi.fn(),
    update: vi.fn(),
    showReport: vi.fn(),
    retry: vi.fn(),
    abandon: vi.fn(),
  };
}
function button(id: string) {
  const found = buttons.find((props) =>
    renderToStaticMarkup(createElement("span", {}, props.children)).includes(id),
  );
  expect(found, id).toBeDefined();
  return found!;
}
async function render(
  options: {
    snapshot?: SourceServerManagementSnapshot;
    source?: SourceServerRecord;
    busy?: boolean;
    actions?: DeviceCardActions;
    connect?: () => Promise<void>;
  } = {},
) {
  const { SourceServerDeviceCard } = await import("./SourceServerDeviceCard.js");
  const cardActions = options.actions ?? actions();
  const html = renderToStaticMarkup(
    createElement(SourceServerDeviceCard, {
      source: options.source ?? source,
      snapshot: options.snapshot ?? snapshot(),
      busy: options.busy ?? false,
      actions: cardActions,
      navigation: { onConnectProfile: options.connect },
      logsByProfileId: {},
    }),
  );
  return { html, cardActions };
}

describe("ZUP10 设备卡实际命令入口（非真实设备 GUI）", () => {
  beforeEach(() => {
    buttons.length = 0;
  });
  it("离线设备仍有移除和编辑入口，编辑交入同一个 Host profile", async () => {
    const { cardActions } = await render();
    button("settings.source.removeSourceServer").onClick?.();
    expect(cardActions.removeSource).toHaveBeenCalledWith(source);
    button("settings.source.editConnection").onClick?.();
    expect(cardActions.edit).toHaveBeenCalledWith(profile, source);
  });
  it("未安装设备的 identity pending 仍可显式确认，不藏在安装状态之后", async () => {
    const { cardActions, html } = await render({
      snapshot: snapshot("identity-change-pending"),
      source: { ...source, installState: "uninstalled" },
    });
    expect(html).toContain("settings.source.identityChangeConfirm");
    button("settings.source.identityChangeConfirm").onClick?.();
    expect(cardActions.confirmIdentity).toHaveBeenCalledWith(profile);
  });
  it("首选线路、迁移报告命令可达；不是静态文本", async () => {
    const data = snapshot();
    const second = { ...profile, profileId: "second", displayName: "Backup route" };
    data.profiles.push(second);
    const { cardActions } = await render({ snapshot: data });
    button("settings.source.setDefault").onClick?.();
    expect(cardActions.setPreferred).toHaveBeenCalledWith(source.sourceServerId, second.profileId);
    button("settings.source.showMigrationReport").onClick?.();
    expect(cardActions.showReport).toHaveBeenCalledWith(source.sourceServerId);
  });
  it("连接交回原 owner；没有 callback 不显示假连接按钮", async () => {
    const { cardActions } = await render({ connect: async () => {} });
    button("remote.action.connect").onClick?.();
    expect(cardActions.profileAction).toHaveBeenCalledWith(
      profile,
      expect.objectContaining({ primaryAction: "connect" }),
      source,
    );
    buttons.length = 0;
    await render();
    expect(
      buttons.some((props) =>
        renderToStaticMarkup(createElement("span", {}, props.children)).includes(
          "remote.action.connect",
        ),
      ),
    ).toBe(false);
  });
  it("更新中禁止其它变更且显示同一 Host 日志进度", async () => {
    const data = snapshot("updating");
    const { html } = await render({ snapshot: data, busy: true });
    expect(button("settings.source.removeSourceServer").disabled).toBe(true);
    expect(button("settings.source.editConnection").disabled).toBe(true);
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("settings.source.updateInProgress");
  });
  it("失败升级可重试，更新指向实际有升级状态的线路", async () => {
    const data = snapshot("failed");
    data.states[0]!.updateAvailability = "required";
    const { cardActions } = await render({ snapshot: data });
    const retry = buttons
      .filter((props) =>
        renderToStaticMarkup(createElement("span", {}, props.children)).includes(
          "remote.action.retry",
        ),
      )
      .at(-1);
    expect(retry).toBeDefined();
    retry?.onClick?.();
    expect(cardActions.update).toHaveBeenCalledWith(profile);
  });
});
