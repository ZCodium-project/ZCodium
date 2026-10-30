import type { ImageComposerTarget } from "@/image-preview-editor/contract.js";
/** 接收方沿用既有附件 API；不能从此处调用发送命令。 */
export const exampleImageComposerTarget: ImageComposerTarget = {
  append: (file) => file.type === "image/png",
};
