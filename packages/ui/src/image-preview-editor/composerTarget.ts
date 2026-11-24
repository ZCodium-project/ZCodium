import type { ImageComposerTarget } from "@/image-preview-editor/contract.js";
const REQUEST_TARGET = "zcode:image-preview-composer-target";
interface TargetRequest {
  target: ImageComposerTarget | null;
}
/** 同步捕获当前接收方。异步导出完成后不能重新查找，以免追加到另一会话。 */
export function captureImageComposerTarget(
  events: EventTarget = window,
): ImageComposerTarget | null {
  const detail: TargetRequest = { target: null };
  events.dispatchEvent(new CustomEvent<TargetRequest>(REQUEST_TARGET, { detail }));
  return detail.target;
}
export function registerImageComposerTarget(
  target: ImageComposerTarget,
  events: EventTarget = window,
): () => void {
  let active = true;
  const receive = (event: Event) => {
    const request = (event as CustomEvent<TargetRequest>).detail;
    if (request.target) return;
    request.target = { append: (file) => active && target.append(file) };
  };
  events.addEventListener(REQUEST_TARGET, receive);
  return () => {
    active = false;
    events.removeEventListener(REQUEST_TARGET, receive);
  };
}
