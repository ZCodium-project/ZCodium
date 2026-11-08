import { useEffect, useEffectEvent, useRef, useState, type PointerEvent } from "react";
import { MinusIcon, PlusIcon } from "lucide-react";
import { Button } from "@/components/ui/button.js";
import { Input } from "@/components/ui/input.js";
import { toast } from "@/components/ui/toast.js";
import { useZCodeIntl } from "@/i18n/IntlProvider.js";
import { logger } from "@/logger.js";
import type { ImagePreviewSurfaceProps } from "@/image-preview-editor/contract.js";
import { captureImageComposerTarget } from "@/image-preview-editor/composerTarget.js";
import { AnnotationLayer, exportAnnotatedImage } from "@/image-preview-editor/annotations.js";
import { ImageEditorToolbar } from "@/image-preview-editor/ImageEditorToolbar.js";
import {
  clampOffset,
  zoomAtPoint,
  updateHistory,
  undoHistory,
  redoHistory,
  type Point,
  type Annotation,
  type AnnotationTool,
  type History,
  type Transform,
} from "@/image-preview-editor/geometry.js";

type Gesture = { start: Point; transform: Transform; annotation?: Annotation; moving?: boolean };
const ZERO = { x: 0, y: 0 };
export function ImagePreviewSurface({
  src,
  alt,
  filename,
  imageTestId,
  onSaved,
  onClose,
}: ImagePreviewSurfaceProps) {
  const { intl } = useZCodeIntl();
  const viewportRef = useRef<HTMLDivElement>(null),
    surfaceRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null),
    overlayRef = useRef<SVGSVGElement>(null);
  const [viewport, setViewport] = useState({ width: 0, height: 0 });
  const [natural, setNatural] = useState({ width: 0, height: 0 });
  const [transform, setTransform] = useState<Transform>({ scale: 1, offset: ZERO });
  const [tool, setTool] = useState<AnnotationTool>("select"),
    [color, setColor] = useState("#ef4444");
  const [history, setHistory] = useState<History<Annotation>>({
    past: [],
    present: [],
    future: [],
  });
  const [draft, setDraft] = useState<Annotation | null>(null),
    [selected, setSelected] = useState<string | null>(null);
  const [textDraft, setTextDraft] = useState<Annotation | null>(null),
    [saving, setSaving] = useState(false),
    [dragging, setDragging] = useState(false);
  const gestureRef = useRef<Gesture | null>(null),
    draftRef = useRef<Annotation | null>(null);
  const pointers = useRef(new Map<number, Point>()),
    pinch = useRef<{ distance: number; transform: Transform } | null>(null);
  const savePending = useRef(false),
    alive = useRef(true);
  const fit = Math.min(
    1,
    viewport.width / (natural.width || 1),
    viewport.height / (natural.height || 1),
  );
  const size = { width: natural.width * fit, height: natural.height * fit };
  const canPan =
    size.width * transform.scale > viewport.width + 1 ||
    size.height * transform.scale > viewport.height + 1;
  const cursor =
    tool === "select"
      ? canPan
        ? dragging
          ? "grabbing"
          : "grab"
        : "default"
      : tool === "text"
        ? "text"
        : "crosshair";
  const displayed = history.present.map((a) => (draft?.id === a.id ? draft : a));
  if (draft && !history.present.some((a) => a.id === draft.id)) displayed.push(draft);
  if (textDraft?.text?.trim()) displayed.push(textDraft);
  const commit = (annotations: Annotation[]) => setHistory((h) => updateHistory(h, annotations));
  const setCurrentDraft = (value: Annotation | null) => {
    draftRef.current = value;
    setDraft(value);
  };
  const undo = () => {
    setHistory(undoHistory);
    setSelected(null);
    setTextDraft(null);
  };
  const redo = () => {
    setHistory(redoHistory);
    setSelected(null);
    setTextDraft(null);
  };
  const applyTransform = (value: Transform) =>
    setTransform({ ...value, offset: clampOffset(value.offset, value.scale, size, viewport) });
  const zoom = (scale: number, anchor: Point = ZERO) =>
    applyTransform(zoomAtPoint(transform, Math.min(3, Math.max(0.5, scale)), anchor));
  const point = (client: Point): Point => {
    const rect = surfaceRef.current!.getBoundingClientRect();
    return {
      x: Math.max(
        0,
        Math.min(natural.width, ((client.x - rect.left) / rect.width) * natural.width),
      ),
      y: Math.max(
        0,
        Math.min(natural.height, ((client.y - rect.top) / rect.height) * natural.height),
      ),
    };
  };
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    const viewport = viewportRef.current;
    if (!viewport) return;
    const observer = new ResizeObserver(() =>
      setViewport({ width: viewport.clientWidth, height: viewport.clientHeight }),
    );
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    setTransform((current) => ({
      ...current,
      offset: clampOffset(current.offset, current.scale, size, viewport),
    }));
  }, [size.width, size.height, viewport.width, viewport.height]);
  const wheel = useEffectEvent((event: WheelEvent) => {
    if (saving || gestureRef.current || !natural.width) return;
    event.preventDefault();
    const rect = viewportRef.current!.getBoundingClientRect();
    const delta =
      event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? rect.height : 1);
    zoom(transform.scale * Math.exp(-Math.max(-300, Math.min(300, delta)) * 0.002), {
      x: event.clientX - rect.left - rect.width / 2,
      y: event.clientY - rect.top - rect.height / 2,
    });
  });
  useEffect(() => {
    const viewport = viewportRef.current;
    // React 的委托 wheel 默认 passive，无法阻止页面滚动；监听仅归当前图片视口所有。
    const listener = (event: WheelEvent) => wheel(event);
    viewport?.addEventListener("wheel", listener, { passive: false });
    return () => viewport?.removeEventListener("wheel", listener);
  }, []);
  const keyboard = useEffectEvent((event: KeyboardEvent) => {
    if (
      saving ||
      (event.target instanceof Element &&
        event.target.closest("input,textarea,[contenteditable=true]"))
    )
      return;
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    } else if (selected && (event.key === "Delete" || event.key === "Backspace")) {
      event.preventDefault();
      commit(history.present.filter((a) => a.id !== selected));
      setSelected(null);
    }
  });
  useEffect(() => {
    const listener = (e: KeyboardEvent) => keyboard(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const pointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (saving || event.button !== 0 || !natural.width) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const client = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, client);
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()];
      pinch.current = { distance: Math.hypot(b!.x - a!.x, b!.y - a!.y), transform };
      setCurrentDraft(null);
      gestureRef.current = null;
      return;
    }
    const start = point(client);
    const id = (event.target as Element)
      .closest("[data-annotation-id]")
      ?.getAttribute("data-annotation-id");
    const annotation = history.present.find((a) => a.id === id);
    if (tool === "eraser") {
      if (annotation) commit(history.present.filter((a) => a.id !== id));
      setSelected(null);
      return;
    }
    if (tool === "text") {
      if (textDraft?.text?.trim()) commit([...history.present, textDraft]);
      setTextDraft({
        id: crypto.randomUUID(),
        tool: "text",
        color,
        width: Math.max(2, 4 / fit),
        points: [start],
        text: "",
      });
      return;
    }
    if (tool === "select") {
      setSelected(annotation?.id ?? null);
      setDragging(Boolean(annotation || canPan));
      gestureRef.current = {
        start: annotation ? start : client,
        transform,
        annotation,
        moving: Boolean(annotation),
      };
      return;
    }
    const mark: Annotation = {
      id: crypto.randomUUID(),
      tool,
      color,
      width: Math.max(2, 3 / fit),
      points: [start],
    };
    gestureRef.current = { start, transform, annotation: mark };
    setCurrentDraft(mark);
  };
  const pointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    const client = { x: event.clientX, y: event.clientY };
    pointers.current.set(event.pointerId, client);
    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const scale = Math.min(
        3,
        Math.max(
          0.5,
          (pinch.current.transform.scale * Math.hypot(b!.x - a!.x, b!.y - a!.y)) /
            (pinch.current.distance || 1),
        ),
      );
      applyTransform({ ...pinch.current.transform, scale });
      return;
    }
    const gesture = gestureRef.current;
    if (!gesture) return;
    if (!gesture.annotation) {
      if (canPan)
        applyTransform({
          ...transform,
          offset: {
            x: gesture.transform.offset.x + client.x - gesture.start.x,
            y: gesture.transform.offset.y + client.y - gesture.start.y,
          },
        });
      return;
    }
    const current = point(client),
      mark = gesture.annotation;
    if (gesture.moving) {
      setCurrentDraft({
        ...mark,
        points: mark.points.map((p) => ({
          x: p.x + current.x - gesture.start.x,
          y: p.y + current.y - gesture.start.y,
        })),
      });
      return;
    }
    setCurrentDraft({
      ...mark,
      points:
        mark.tool === "pen"
          ? [...(draftRef.current?.points ?? mark.points), current]
          : [gesture.start, current],
    });
  };
  const pointerEnd = (event: PointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(event.pointerId)) return;
    pointers.current.delete(event.pointerId);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    const mark = draftRef.current;
    // cancel/lostcapture 不提交半条标注；主动 release 后的重复事件由 pointer 集合过滤。
    if (event.type === "pointerup" && mark)
      commit(
        gestureRef.current?.moving
          ? history.present.map((a) => (a.id === mark.id ? mark : a))
          : [...history.present, mark],
      );
    setCurrentDraft(null);
    gestureRef.current = null;
    pinch.current = null;
    setDragging(false);
  };
  const save = async () => {
    if (savePending.current || !imageRef.current || !overlayRef.current) return;
    const target = captureImageComposerTarget();
    if (!target) {
      toast(intl.formatMessage({ id: "imageEditor.noComposer" }));
      return;
    }
    savePending.current = true;
    setSaving(true);
    try {
      const file = await exportAnnotatedImage(
        imageRef.current,
        overlayRef.current,
        filename || alt,
      );
      if (!alive.current) return;
      if (!target.append(file)) throw new Error("Composer rejected the image");
      onSaved();
    } catch (error) {
      if (!alive.current) return;
      logger.warn("[ImagePreviewDialog] 标注图片保存失败", {
        error: error instanceof Error ? error.message : String(error),
      });
      toast(intl.formatMessage({ id: "imageEditor.saveFailed" }));
    } finally {
      savePending.current = false;
      if (alive.current) setSaving(false);
    }
  };
  return (
    <>
      <div
        className="absolute inset-x-4 bottom-28 top-20 overflow-hidden sm:inset-x-20 sm:bottom-16"
        data-image-preview-viewport=""
        ref={viewportRef}
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
      >
        <div
          data-image-preview-surface=""
          ref={surfaceRef}
          className="absolute left-1/2 top-1/2 touch-none select-none"
          onClick={(event) => event.stopPropagation()}
          onPointerDown={pointerDown}
          onPointerMove={pointerMove}
          onPointerUp={pointerEnd}
          onPointerCancel={pointerEnd}
          onLostPointerCapture={pointerEnd}
          style={{
            width: size.width,
            height: size.height,
            cursor,
            transform: `translate(-50%, -50%) translate(${transform.offset.x}px, ${transform.offset.y}px) scale(${transform.scale})`,
          }}
        >
          <img
            alt={alt}
            src={src}
            ref={imageRef}
            data-testid={imageTestId}
            draggable={false}
            className="size-full rounded-xl object-contain"
            onLoad={(event) =>
              setNatural({
                width: event.currentTarget.naturalWidth,
                height: event.currentTarget.naturalHeight,
              })
            }
          />
          <svg
            ref={overlayRef}
            className="pointer-events-none absolute inset-0 size-full overflow-hidden text-foreground"
            viewBox={`0 0 ${natural.width || 1} ${natural.height || 1}`}
            xmlns="http://www.w3.org/2000/svg"
          >
            <AnnotationLayer annotations={displayed} selected={selected} />
          </svg>
        </div>
      </div>
      <ImageEditorToolbar
        tool={tool}
        onTool={(value) => {
          setTool(value);
          setSelected(null);
          if (textDraft?.text?.trim()) commit([...history.present, textDraft]);
          setTextDraft(null);
        }}
        color={color}
        onColor={setColor}
        undo={undo}
        redo={redo}
        canUndo={history.past.length > 0}
        canRedo={history.future.length > 0}
        disabled={saving || !natural.width}
      />
      {textDraft ? (
        <div
          className="absolute left-1/2 top-20 z-30 flex max-w-full -translate-x-1/2 gap-1 rounded-xl border border-popover-border bg-popover p-2"
          onKeyDown={(event) => event.stopPropagation()}
        >
          <Input
            autoFocus
            aria-label={intl.formatMessage({ id: "imageEditor.textValue" })}
            value={textDraft.text}
            disabled={saving}
            className="w-48 text-mobile-input-safe sm:text-ui-base"
            onChange={(event) => setTextDraft({ ...textDraft, text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                if (textDraft.text?.trim()) commit([...history.present, textDraft]);
                setTextDraft(null);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setTextDraft(null);
              }
            }}
          />
          <Button
            onClick={() => {
              if (textDraft.text?.trim()) commit([...history.present, textDraft]);
              setTextDraft(null);
            }}
            disabled={saving}
          >
            {intl.formatMessage({ id: "imageEditor.applyText" })}
          </Button>
        </div>
      ) : null}
      {/* 禁用按钮不接收指针事件，用容器接住点击，避免穿透到遮罩而关闭预览。 */}
      <div className="absolute left-4 top-4 z-20 platform-mac-desktop:top-12 platform-windows-desktop:top-[calc(env(titlebar-area-height,48px)_+_0.5rem)]">
        <Button
          data-image-preview-save=""
          disabled={saving || displayed.length === 0}
          onClick={() => void save()}
        >
          {intl.formatMessage({ id: saving ? "imageEditor.saving" : "imageEditor.save" })}
        </Button>
      </div>
      <div className="absolute bottom-4 left-1/2 z-20 flex -translate-x-1/2 items-center gap-2 rounded-full border border-popover-border bg-popover p-1 shadow-md">
        <Button
          aria-label={intl.formatMessage({ id: "markdownImage.zoomOut" })}
          disabled={saving || transform.scale <= 0.5}
          onClick={() => zoom(transform.scale - 0.5)}
          size="icon-sm"
          variant="ghost"
          className="rounded-full"
        >
          <MinusIcon />
        </Button>
        <span className="min-w-12 text-center text-ui-base">
          {Math.round(transform.scale * 100)}%
        </span>
        <Button
          aria-label={intl.formatMessage({ id: "markdownImage.zoomIn" })}
          disabled={saving || transform.scale >= 3}
          onClick={() => zoom(transform.scale + 0.5)}
          size="icon-sm"
          variant="ghost"
          className="rounded-full"
        >
          <PlusIcon />
        </Button>
      </div>
    </>
  );
}
