export const imagePreviewEditorModule = {
  id: "image-preview-editor",
  requires: ["ui"],
  provides: ["image-preview-editor"],
  publicEntrypoints: ["index.ts", "contract.ts"],
} as const;
