import { act, createElement, useState } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import type { RemoteConnectionProgress } from "../contract.js";
import {
  RemoteConnectionProgressProvider,
  usePublishRemoteConnectionProgress,
  useRemoteConnectionProgress,
} from "./RemoteConnectionProgress.js";

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

describe("连接进度 Context 生命周期", () => {
  it("发布方不订阅读投影：自身发布不引起反馈重渲染，卸载清空且不调用业务动作", async () => {
    const dom = installDom();
    const root = createRoot(dom.container);
    let renders = 0;
    let latest: RemoteConnectionProgress | null = null;
    let update: ((next: RemoteConnectionProgress) => void) | undefined;
    const initial: RemoteConnectionProgress = {
      view: "connecting",
      loading: true,
      selectingDirectory: false,
      dialogOpen: false,
      error: "",
      ready: false,
      logs: [],
      onResume: vi.fn(),
      onCancel: vi.fn(),
    };
    function Publisher() {
      renders += 1;
      const [progress, setProgress] = useState(initial);
      update = setProgress;
      usePublishRemoteConnectionProgress(progress);
      return null;
    }
    function Reader() {
      latest = useRemoteConnectionProgress();
      return null;
    }
    try {
      await act(async () => {
        root.render(
          createElement(
            RemoteConnectionProgressProvider,
            {},
            createElement(Publisher),
            createElement(Reader),
          ),
        );
      });
      expect(renders).toBe(1);
      expect(latest).toBe(initial);
      const ready = { ...initial, view: "directory" as const, loading: false, ready: true };
      await act(async () => {
        update?.(ready);
      });
      expect(renders).toBe(2);
      expect(latest).toBe(ready);
      expect(initial.onResume).not.toHaveBeenCalled();
      expect(initial.onCancel).not.toHaveBeenCalled();
      await act(async () => {
        root.render(createElement(RemoteConnectionProgressProvider, {}, createElement(Reader)));
      });
      expect(latest).toBeNull();
    } finally {
      await act(async () => {
        root.unmount();
      });
      dom.restore();
    }
  });
});
