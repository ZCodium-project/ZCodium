import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("../src/settings/AutomationEditView.tsx", import.meta.url),
  "utf8",
);

describe("AutomationEditView 无项目会话展示契约", () => {
  it("已有未归类任务保留固定文案，新建只选 Host 虚拟项目", () => {
    expect(source).toContain('id: "chat.empty.workOutsideProject"');
    expect(source).toContain('data-testid="automation-project-select"');
    expect(source).toContain("projectId: selectedWorkspace.projectId");
    expect(source).not.toContain("includeConversationWorkspace");
    expect(source).not.toContain("ChatEmptyWorkspacePreviewMenu");
  });
});
