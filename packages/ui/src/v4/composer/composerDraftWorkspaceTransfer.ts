import type { ChatComposerAttachment } from "@/lib/chatAttachments.js";
import { readComposerAttachmentScope } from "@/store/composerAttachmentUploadStore.js";
import {
  readV4ComposerDraft,
  readComposerWorkspaceScope,
  composerScopeKey,
  V4_DRAFT_SCOPE_ROOT,
  type V4ComposerDraft,
} from "@/v4/composer/composerDraftStore.js";

export interface ComposerDraftHandoff {
  sourceWorkspaceKey: string;
  draft: Omit<V4ComposerDraft, "updatedAt">;
  attachments: readonly ChatComposerAttachment[];
}
type DraftReader = () => Omit<ComposerDraftHandoff, "sourceWorkspaceKey">;
const draftReaders = new Map<string, DraftReader>();
const incomingAttachments = new Map<
  string,
  { draftFocusVersion: number; attachments: readonly ChatComposerAttachment[] }
>();
export function registerV4ComposerDraftReader(workspaceKey: string, read: DraftReader): () => void {
  draftReaders.set(workspaceKey, read);
  return () => {
    if (draftReaders.get(workspaceKey) === read) draftReaders.delete(workspaceKey);
  };
}
export function captureV4ComposerDraftHandoff(
  workspacePath: string,
  workspaceIdentity?: string,
  clientNamespace = "desktop",
): ComposerDraftHandoff {
  const sourceWorkspaceKey = getWorkspaceKey(workspacePath, workspaceIdentity);
  const scope = readComposerWorkspaceScope(workspacePath, workspaceIdentity, clientNamespace);
  return {
    sourceWorkspaceKey,
    ...(draftReaders.get(sourceWorkspaceKey)?.() ?? {
      draft: readV4ComposerDraft(workspacePath, workspaceIdentity, V4_DRAFT_SCOPE_ROOT, scope) ?? {
        text: "",
      },
      attachments: readComposerAttachmentScope(
        `${sourceWorkspaceKey}\0${V4_DRAFT_SCOPE_ROOT}${scope ? `:${composerScopeKey(scope)}` : ""}`,
      ),
    }),
  };
}
export function stageV4ComposerDraftAttachments(
  workspacePath: string,
  workspaceIdentity: string | undefined,
  draftFocusVersion: number,
  handoff: ComposerDraftHandoff,
): void {
  // 同 cwd 的新项目也有独立附件作用域，不能跳过显式交接。
  incomingAttachments.set(getWorkspaceKey(workspacePath, workspaceIdentity), {
    draftFocusVersion,
    attachments: handoff.attachments,
  });
}
export function consumeV4ComposerDraftAttachments(
  workspaceKey: string,
  draftFocusVersion: number,
): readonly ChatComposerAttachment[] | null {
  const pending = incomingAttachments.get(workspaceKey);
  incomingAttachments.delete(workspaceKey);
  return pending?.draftFocusVersion === draftFocusVersion ? pending.attachments : null;
}

interface ComposerDraftWorkspaceTransferRequest {
  sourceWorkspacePath: string;
  sourceWorkspaceIdentity?: string;
  targetWorkspacePath: string;
  targetWorkspaceIdentity?: string;
}

let pendingRequest: ComposerDraftWorkspaceTransferRequest | null = null;

function getWorkspaceKey(path: string, identity?: string): string {
  return identity?.trim() || path;
}

export function requestV4ComposerDraftWorkspaceTransfer(
  request: ComposerDraftWorkspaceTransferRequest,
): void {
  pendingRequest = request;
}

export function consumeV4ComposerDraftWorkspaceTransferRequest(
  transition: ComposerDraftWorkspaceTransferRequest,
): boolean {
  if (!pendingRequest) {
    return false;
  }
  const matches =
    getWorkspaceKey(pendingRequest.sourceWorkspacePath, pendingRequest.sourceWorkspaceIdentity) ===
      getWorkspaceKey(transition.sourceWorkspacePath, transition.sourceWorkspaceIdentity) &&
    getWorkspaceKey(pendingRequest.targetWorkspacePath, pendingRequest.targetWorkspaceIdentity) ===
      getWorkspaceKey(transition.targetWorkspacePath, transition.targetWorkspaceIdentity);
  if (matches) {
    pendingRequest = null;
  }
  return matches;
}

export function clearV4ComposerDraftWorkspaceTransferRequest(): void {
  pendingRequest = null;
}
