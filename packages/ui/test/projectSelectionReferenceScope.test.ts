// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import {
  dispatchConversationSelectionAdd,
  getConversationSelectionReferenceScope,
  getConversationSelectionReferenceLimitReason,
  setConversationSelectionReferenceScope,
  type ConversationSelectionReference,
} from "@/lib/conversationSelectionReference.js";
import { useConversationSelectionReferences } from "@/v4/composer/useConversationSelectionReferences.js";

const key = "/qa-selection-same-cwd";
const reference = (id: string): ConversationSelectionReference => ({
  id,
  contentType: "markdown",
  sourceKey: "qa-markdown",
  sourceTitle: "QA",
  text: id,
});
afterEach(() => {
  cleanup();
  for (const scope of ["project:p", "project:q"])
    setConversationSelectionReferenceScope(null, key, [], scope);
  setConversationSelectionReferenceScope("formal-task", key, []);
});

it("同 cwd 不同项目的 Markdown 引用与超限错误彼此隔离", () => {
  dispatchConversationSelectionAdd({
    targetSessionId: null,
    workspaceKey: key,
    draftScopeKey: "project:p",
    reference: reference("p-selection"),
  });
  expect(getConversationSelectionReferenceScope(null, key, "project:q")).toEqual([]);
  dispatchConversationSelectionAdd({
    targetSessionId: null,
    workspaceKey: key,
    draftScopeKey: "project:q",
    reference: reference("q-selection"),
  });
  expect(
    getConversationSelectionReferenceScope(null, key, "project:p").map((item) => item.id),
  ).toEqual(["p-selection"]);
  dispatchConversationSelectionAdd({
    targetSessionId: null,
    workspaceKey: key,
    draftScopeKey: "project:p",
    reference: { ...reference("large"), text: "a".repeat(50000) },
  });
  expect(getConversationSelectionReferenceLimitReason(null, key, "project:p")).toBe("single");
  expect(getConversationSelectionReferenceLimitReason(null, key, "project:q")).toBeNull();
});

it("Composer 切换项目后只接受该项目事件，旧项目迟到引用不得写入新草稿", () => {
  const { result, rerender } = renderHook(
    ({ draftScopeKey }) =>
      useConversationSelectionReferences({ sessionId: null, workspaceKey: key, draftScopeKey }),
    { initialProps: { draftScopeKey: "project:p" } },
  );
  act(() => {
    dispatchConversationSelectionAdd({
      targetSessionId: null,
      workspaceKey: key,
      draftScopeKey: "project:p",
      reference: reference("p-selection"),
    });
  });
  expect(result.current.references.map((item) => item.id)).toEqual(["p-selection"]);
  rerender({ draftScopeKey: "project:q" });
  expect(result.current.references).toEqual([]);
  act(() => {
    dispatchConversationSelectionAdd({
      targetSessionId: null,
      workspaceKey: key,
      draftScopeKey: "project:p",
      reference: reference("p-late"),
    });
  });
  expect(result.current.references).toEqual([]);
  act(() => {
    dispatchConversationSelectionAdd({
      targetSessionId: null,
      workspaceKey: key,
      draftScopeKey: "project:q",
      reference: reference("q-selection"),
    });
  });
  expect(result.current.references.map((item) => item.id)).toEqual(["q-selection"]);
  act(() => result.current.clearReferences());
  expect(getConversationSelectionReferenceScope(null, key, "project:p")).toHaveLength(2);
});

it("正式会话仍按 session/cwd 身份，项目 scope 不改写其既有引用", () => {
  setConversationSelectionReferenceScope("formal-task", key, [reference("formal")], "project:p");
  expect(
    getConversationSelectionReferenceScope("formal-task", key, "project:q").map((item) => item.id),
  ).toEqual(["formal"]);
});
