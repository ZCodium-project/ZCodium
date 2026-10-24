import { act, createElement, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE } from "@zcode/shared";
import type { RemoteConnectionProgress } from "../../contract.js";
import {
  RemoteConnectionProgressProvider,
  useRemoteConnectionProgress,
} from "../RemoteConnectionProgress.js";

const captured = vi.hoisted(() => ({
  kind: null as { onNext: () => void } | null,
  settings: null as { onConnect: () => void } | null,
  header: null as { onMinimize?: () => void } | null,
  directory: null as { onSelect: (path: string) => void } | null,
  cancelPending: vi.fn(async (_requestId?: string) => {}),
  confirm: vi.fn(async () => true),
  logs: [
    { id: "log-1", level: "info" as const, timestamp: "10:00:00", message: "Actual deploy output" },
  ],
}));
vi.mock("@/i18n/IntlProvider.js", () => ({
  useZCodeIntl: () => ({ intl: { formatMessage: ({ id }: { id: string }) => id } }),
}));
vi.mock("@/hooks/useConfirmDialog.js", () => ({ useConfirmDialog: () => captured.confirm }));
vi.mock("@/hooks/useCancelPendingRemoteConnection.js", () => ({
  useCancelPendingRemoteConnection: () => captured.cancelPending,
}));
vi.mock("@/hooks/useRemoteConnectionLogs.js", () => ({
  useRemoteConnectionLogs: () => ({ connectionLogs: captured.logs, resetConnectionLogs() {} }),
}));
vi.mock("@/hooks/useWorkspaceServices.js", () => ({ useBaseWorkspaceServices: () => ({}) }));
vi.mock("@/hooks/useRemoteConnectionForm.js", () => ({
  useRemoteConnectionForm: () => ({
    kind: "ssh",
    host: "example.test",
    port: "22",
    username: "user",
    sshAuthMethod: "password",
    assetInstallMode: "local-download-upload",
    password: "test-only-secret",
    privateKeyPath: "",
    privateKeyPassphrase: "",
    wslDistro: "",
    wslUser: "",
    dockerContainer: "",
    manualDockerContainer: "",
    serverUrl: "",
    serverName: "",
    serverToken: "",
    serverWorkspacePath: "",
    availableKinds: ["ssh"],
  }),
}));
vi.mock("@/components/ui/button.js", () => ({
  Button: ({ children }: { children?: ReactNode }) => createElement("button", {}, children),
  buttonVariants: () => "",
}));
vi.mock("@/components/ui/dialog.js", () => ({
  Dialog: ({ open, children }: { open: boolean; children?: ReactNode }) =>
    open ? createElement("div", {}, children) : null,
  DialogContent: ({ children }: { children?: ReactNode }) => createElement("div", {}, children),
  DialogHeader: ({ children }: { children?: ReactNode }) => createElement("div", {}, children),
}));
vi.mock("@/RemoteConnectionWizardChrome.js", () => ({
  RemoteConnectionWizardSidebar: () => null,
  RemoteConnectionWizardHeader: (props: typeof captured.header) => {
    captured.header = props;
    return null;
  },
}));
vi.mock("@/RemoteConnectionDialogContent.js", () => ({
  RemoteConnectionKindStep: (props: typeof captured.kind) => {
    captured.kind = props;
    return null;
  },
  RemoteConnectionSettingsStep: (props: typeof captured.settings) => {
    captured.settings = props;
    return null;
  },
  RemoteConnectionConnectingStep: () => null,
  RemoteConnectionDirectoryStep: (props: typeof captured.directory) => {
    captured.directory = props;
    return null;
  },
}));

import { RemoteConnectionDialog } from "@/SSHDialog.js";

function element(ownerDocument: Document, tagName = "div"): Element {
  const node = {
    nodeType: 1,
    nodeName: tagName.toUpperCase(),
    tagName: tagName.toUpperCase(),
    ownerDocument,
    parentNode: null as unknown,
    childNodes: [] as unknown[],
    style: {},
    addEventListener() {},
    removeEventListener() {},
    getAttribute() {
      return null;
    },
    setAttribute() {},
    removeAttribute() {},
    appendChild(child: { parentNode?: unknown }) {
      child.parentNode = node;
      return child;
    },
    insertBefore(child: { parentNode?: unknown }) {
      child.parentNode = node;
      return child;
    },
    removeChild(child: { parentNode?: unknown }) {
      child.parentNode = null;
      return child;
    },
  };
  return node as unknown as Element;
}
function installDom() {
  const documentMock = {
    nodeType: 9,
    addEventListener() {},
    removeEventListener() {},
    createElement: (name: string) => element(documentMock as unknown as Document, name),
    createTextNode: (nodeValue: string) => ({
      nodeType: 3,
      nodeValue,
      ownerDocument: documentMock,
      parentNode: null,
    }),
  } as unknown as Document;
  const old = new Map(
    ["document", "window", "IS_REACT_ACT_ENVIRONMENT"].map((key) => [
      key,
      Object.getOwnPropertyDescriptor(globalThis, key),
    ]),
  );
  Object.defineProperty(globalThis, "document", { configurable: true, value: documentMock });
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: {
      document: documentMock,
      HTMLElement: function HTMLElement() {},
      HTMLIFrameElement: function HTMLIFrameElement() {},
      Node: function Node() {},
      addEventListener() {},
      removeEventListener() {},
    },
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  return {
    container: element(documentMock),
    restore() {
      for (const [key, descriptor] of old) {
        if (descriptor) Object.defineProperty(globalThis, key, descriptor);
        else Reflect.deleteProperty(globalThis, key);
      }
    },
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function mount(
  onConnect: (
    target: import("../../contract.js").RemoteTarget,
    requestId?: string,
    context?: import("@zcode/shared").RemoteConnectionContext,
  ) => Promise<string>,
) {
  const dom = installDom();
  const root = createRoot(dom.container);
  let progress: RemoteConnectionProgress | null = null;
  const onSelectProject = vi.fn(async (_id: string, _path: string) => {});
  const onCancelSession = vi.fn(async (_id: string) => {});
  function Reader() {
    progress = useRemoteConnectionProgress();
    return null;
  }
  function Owner() {
    const [open, setOpen] = useState(true);
    return createElement(RemoteConnectionDialog, {
      open,
      onOpenChange: setOpen,
      onConnect,
      onSelectProject,
      onCancelSession,
    });
  }
  await act(async () => {
    root.render(
      createElement(
        RemoteConnectionProgressProvider,
        {},
        createElement(Owner),
        createElement(Reader),
      ),
    );
  });
  return {
    getProgress: () => progress,
    onSelectProject,
    onCancelSession,
    async close() {
      await act(async () => {
        root.unmount();
      });
      dom.restore();
    },
  };
}

describe("SSHDialog 原 owner → 共享进度适配", () => {
  afterEach(() => {
    captured.kind = null;
    captured.settings = null;
    captured.header = null;
    captured.directory = null;
    captured.cancelPending.mockClear();
    captured.confirm.mockClear();
  });
  it("收起保留同一 request 的实际日志；ready 不选项目，恢复后显式选择才走原提交", async () => {
    const connection = deferred<string>();
    const onConnect = vi.fn(() => connection.promise);
    const view = await mount(onConnect);
    try {
      expect(view.getProgress()).toBeNull();
      await act(async () => {
        captured.kind?.onNext();
      });
      await act(async () => {
        captured.settings?.onConnect();
      });
      const requestId = view.getProgress()?.requestId;
      expect(requestId).toBeTruthy();
      await act(async () => {
        captured.header?.onMinimize?.();
      });
      expect(view.getProgress()).toMatchObject({ dialogOpen: false, loading: true, requestId });
      expect(view.getProgress()?.logs[0]?.message).toBe("Actual deploy output");
      expect(JSON.stringify(view.getProgress())).not.toContain("test-only-secret");
      await act(async () => {
        connection.resolve("existing-session");
        await connection.promise;
      });
      expect(view.getProgress()).toMatchObject({ ready: true, view: "directory", loading: false });
      expect(view.onSelectProject).not.toHaveBeenCalled();
      expect(onConnect).toHaveBeenCalledOnce();
      await act(async () => {
        captured.header?.onMinimize?.();
      });
      expect(view.getProgress()?.dialogOpen).toBe(false);
      await act(async () => {
        view.getProgress()?.onResume();
      });
      expect(view.getProgress()?.dialogOpen).toBe(true);
      expect(view.onSelectProject).not.toHaveBeenCalled();
      await act(async () => {
        captured.directory?.onSelect("/owned/project");
      });
      expect(view.onSelectProject).toHaveBeenCalledWith(
        "existing-session",
        "/owned/project",
        undefined,
      );
      expect(view.getProgress()).toBeNull();
    } finally {
      await view.close();
    }
  });
  it("取消调用原 requestId 精准清理，不因发布进度另起连接", async () => {
    const connection = deferred<string>();
    const onConnect = vi.fn(() => connection.promise);
    const view = await mount(onConnect);
    try {
      await act(async () => {
        captured.kind?.onNext();
      });
      await act(async () => {
        captured.settings?.onConnect();
      });
      const requestId = view.getProgress()?.requestId;
      await act(async () => {
        await view.getProgress()?.onCancel();
      });
      expect(captured.cancelPending).toHaveBeenCalledWith(requestId);
      expect(onConnect).toHaveBeenCalledOnce();
      expect(view.onCancelSession).not.toHaveBeenCalled();
      expect(view.getProgress()).toBeNull();
    } finally {
      await view.close();
    }
  });
  it("#68 install-required 仍由原确认路径授权，投影不绕过准入", async () => {
    const onConnect = vi
      .fn()
      .mockRejectedValueOnce({ code: SOURCE_SERVER_INSTALL_REQUIRED_ERROR_CODE })
      .mockResolvedValueOnce("existing-session");
    const view = await mount(onConnect);
    try {
      await act(async () => {
        captured.kind?.onNext();
      });
      await act(async () => {
        captured.settings?.onConnect();
      });
      expect(captured.confirm).toHaveBeenCalledOnce();
      expect(onConnect.mock.calls[0]?.[2]).toBeUndefined();
      expect(onConnect.mock.calls[1]?.[2]).toEqual({ confirmSourceServerInstall: true });
      expect(onConnect.mock.calls[0]?.[1]).not.toBe(onConnect.mock.calls[1]?.[1]);
      expect(view.getProgress()?.ready).toBe(true);
      expect(view.onSelectProject).not.toHaveBeenCalled();
    } finally {
      await view.close();
    }
  });
});
