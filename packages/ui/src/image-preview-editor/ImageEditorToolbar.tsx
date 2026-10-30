import {
  MousePointer2Icon,
  PencilIcon,
  TypeIcon,
  SquareIcon,
  CircleIcon,
  ArrowUpRightIcon,
  EraserIcon,
  Undo2Icon,
  Redo2Icon,
} from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import type { AnnotationTool } from "@/image-preview-editor/geometry.js";
const TOOLS = [
  ["select", MousePointer2Icon],
  ["pen", PencilIcon],
  ["text", TypeIcon],
  ["rectangle", SquareIcon],
  ["ellipse", CircleIcon],
  ["arrow", ArrowUpRightIcon],
  ["eraser", EraserIcon],
] as const;
export function ImageEditorToolbar({
  tool,
  onTool,
  color,
  onColor,
  undo,
  redo,
  canUndo,
  canRedo,
  disabled,
}: {
  tool: AnnotationTool;
  onTool: (value: AnnotationTool) => void;
  color: string;
  onColor: (value: string) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  disabled: boolean;
}) {
  const { intl } = useZCodeIntl();
  return (
    <div
      role="toolbar"
      aria-label={intl.formatMessage({ id: "imageEditor.tools" })}
      className="absolute bottom-14 left-1/2 z-20 flex max-w-full -translate-x-1/2 items-center gap-1 overflow-x-auto rounded-xl border border-popover-border bg-popover p-1 shadow-md sm:bottom-auto sm:left-auto sm:right-4 sm:top-1/2 sm:-translate-x-0 sm:-translate-y-1/2 sm:flex-col"
    >
      {TOOLS.map(([value, Icon]) => (
        <Button
          key={value}
          data-image-preview-tool={value}
          title={intl.formatMessage({ id: `imageEditor.${value}` })}
          aria-label={intl.formatMessage({ id: `imageEditor.${value}` })}
          aria-pressed={tool === value}
          disabled={disabled}
          onClick={() => onTool(value)}
          variant={tool === value ? "secondary" : "ghost"}
          size="icon-md"
        >
          <Icon />
        </Button>
      ))}
      <input
        type="color"
        aria-label={intl.formatMessage({ id: "imageEditor.color" })}
        title={intl.formatMessage({ id: "imageEditor.color" })}
        value={color}
        onChange={(event) => onColor(event.target.value)}
        disabled={disabled}
        className="size-7 shrink-0 cursor-pointer rounded-md border-0 bg-transparent p-0"
      />
      <Button
        title={intl.formatMessage({ id: "imageEditor.undo" })}
        aria-label={intl.formatMessage({ id: "imageEditor.undo" })}
        disabled={disabled || !canUndo}
        onClick={undo}
        variant="ghost"
        size="icon-md"
      >
        <Undo2Icon />
      </Button>
      <Button
        title={intl.formatMessage({ id: "imageEditor.redo" })}
        aria-label={intl.formatMessage({ id: "imageEditor.redo" })}
        disabled={disabled || !canRedo}
        onClick={redo}
        variant="ghost"
        size="icon-md"
      >
        <Redo2Icon />
      </Button>
    </div>
  );
}
