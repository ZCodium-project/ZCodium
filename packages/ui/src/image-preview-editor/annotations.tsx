import type { Annotation } from "@/image-preview-editor/geometry.js";

export function AnnotationShape({ annotation }: { annotation: Annotation }) {
  const { points, tool, color, width, text } = annotation;
  const start = points[0]!;
  const end = points.at(-1)!;
  const x = Math.min(start.x, end.x),
    y = Math.min(start.y, end.y);
  const w = Math.abs(end.x - start.x),
    h = Math.abs(end.y - start.y);
  if (tool === "text")
    return (
      <text
        x={start.x}
        y={start.y}
        fill={color}
        stroke="none"
        fontFamily="sans-serif"
        fontSize={width * 6}
        dominantBaseline="hanging"
      >
        {text}
      </text>
    );
  if (tool === "rectangle") return <rect x={x} y={y} width={w} height={h} />;
  if (tool === "ellipse") return <ellipse cx={x + w / 2} cy={y + h / 2} rx={w / 2} ry={h / 2} />;
  if (tool === "arrow") {
    const angle = Math.atan2(end.y - start.y, end.x - start.x),
      length = width * 4;
    return (
      <path
        d={`M${start.x},${start.y} L${end.x},${end.y} M${end.x - length * Math.cos(angle - 0.5)},${end.y - length * Math.sin(angle - 0.5)} L${end.x},${end.y} L${end.x - length * Math.cos(angle + 0.5)},${end.y - length * Math.sin(angle + 0.5)}`}
      />
    );
  }
  if (points.length === 1)
    return <circle cx={start.x} cy={start.y} r={width / 2} fill={color} stroke="none" />;
  return <polyline points={points.map((p) => `${p.x},${p.y}`).join(" ")} />;
}

export function AnnotationLayer({
  annotations,
  selected,
}: {
  annotations: readonly Annotation[];
  selected: string | null;
}) {
  return (
    <>
      {annotations.map((annotation) => (
        <g
          key={annotation.id}
          data-annotation-id={annotation.id}
          stroke={annotation.color}
          fill="none"
          strokeWidth={annotation.width}
          strokeLinecap="round"
          strokeLinejoin="round"
          style={{ pointerEvents: "visiblePainted" }}
        >
          <AnnotationShape annotation={annotation} />
          {selected === annotation.id ? (
            <rect
              data-selection=""
              x={Math.min(...annotation.points.map((p) => p.x)) - annotation.width * 2}
              y={Math.min(...annotation.points.map((p) => p.y)) - annotation.width * 2}
              width={Math.max(
                annotation.width * 4,
                Math.max(...annotation.points.map((p) => p.x)) -
                  Math.min(...annotation.points.map((p) => p.x)) +
                  annotation.width * 4,
              )}
              height={Math.max(
                annotation.width * 4,
                Math.max(...annotation.points.map((p) => p.y)) -
                  Math.min(...annotation.points.map((p) => p.y)) +
                  annotation.width * 4,
              )}
              stroke="currentColor"
              strokeDasharray="4 4"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              pointerEvents="none"
            />
          ) : null}
        </g>
      ))}
    </>
  );
}

export async function exportAnnotatedImage(
  image: HTMLImageElement,
  overlay: SVGSVGElement,
  filename: string,
): Promise<File> {
  // 只栅格化当前原图与标注；不用屏幕截图，避免缩放和主题背景污染输出像素。
  if (
    !image.naturalWidth ||
    !image.naturalHeight ||
    image.naturalWidth * image.naturalHeight > 32_000_000
  )
    throw new Error("Image dimensions exceed the export limit");
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Canvas unavailable");
  context.drawImage(image, 0, 0);
  const clone = overlay.cloneNode(true) as SVGSVGElement;
  clone.querySelectorAll("[data-selection]").forEach((el) => el.remove());
  clone.setAttribute("width", String(canvas.width));
  clone.setAttribute("height", String(canvas.height));
  clone.removeAttribute("class");
  clone.removeAttribute("style");
  const url = URL.createObjectURL(
    new Blob([new XMLSerializer().serializeToString(clone)], { type: "image/svg+xml" }),
  );
  try {
    const layer = new Image();
    layer.src = url;
    await layer.decode();
    context.drawImage(layer, 0, 0);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (value) => (value ? resolve(value) : reject(new Error("PNG export failed"))),
        "image/png",
      ),
    );
    const base =
      filename
        .replace(/\.[a-z0-9]+$/iu, "")
        .replace(/[<>:"/\\|?*\p{Cc}]/gu, "-")
        .slice(0, 80) || "image";
    return new File([blob], `${base}-edited.png`, { type: "image/png" });
  } finally {
    URL.revokeObjectURL(url);
  }
}
