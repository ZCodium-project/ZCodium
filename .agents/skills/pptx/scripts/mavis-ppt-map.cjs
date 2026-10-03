const fs = require('fs');
const path = require('path');

const DEFAULT_LAYOUT = Object.freeze({
  name: 'LAYOUT_16x9',
  widthIn: 10,
  heightIn: 5.625,
});

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function round(value) {
  return Math.round(value * 10000) / 10000;
}

function requireString(value, field) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`Missing required PPT element map field: ${field}`);
  }
  return value.trim();
}

function normalizeLayout(layout) {
  const candidate = layout || DEFAULT_LAYOUT;
  const widthIn = finiteNumber(candidate.widthIn);
  const heightIn = finiteNumber(candidate.heightIn);
  if (!widthIn || !heightIn || widthIn <= 0 || heightIn <= 0) {
    throw new Error('PPT element map layout must include positive widthIn and heightIn');
  }
  return {
    name: typeof candidate.name === 'string' && candidate.name ? candidate.name : DEFAULT_LAYOUT.name,
    widthIn,
    heightIn,
  };
}

function normalizeRect(input, layout) {
  const x = finiteNumber(input && input.x);
  const y = finiteNumber(input && input.y);
  const w = finiteNumber(input && input.w);
  const h = finiteNumber(input && input.h);
  if (x === null || y === null || w === null || h === null) {
    throw new Error('PPT element map rect must include numeric x, y, w, and h');
  }
  if (w < 0 || h < 0) {
    throw new Error('PPT element map rect width and height must be non-negative');
  }
  const rect = {
    x: round(x),
    y: round(y),
    w: round(w),
    h: round(h),
  };
  if (x < 0 || y < 0 || x + w > layout.widthIn || y + h > layout.heightIn) {
    throw new Error(
      `PPT element map rect is outside ${layout.name} bounds: ${JSON.stringify(rect)}`,
    );
  }
  return rect;
}

function toNormalizedRect(rect, layout = DEFAULT_LAYOUT) {
  const normalizedLayout = normalizeLayout(layout);
  const normalizedRect = normalizeRect(rect, normalizedLayout);
  return {
    x: round(normalizedRect.x / normalizedLayout.widthIn),
    y: round(normalizedRect.y / normalizedLayout.heightIn),
    w: round(normalizedRect.w / normalizedLayout.widthIn),
    h: round(normalizedRect.h / normalizedLayout.heightIn),
  };
}

function compactObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''),
  );
}

function pickStyle(options) {
  if (!options || typeof options !== 'object') return undefined;
  const keys = [
    'fontSize',
    'fontFace',
    'color',
    'bold',
    'italic',
    'underline',
    'align',
    'valign',
    'margin',
    'fit',
    'fill',
    'line',
    'transparency',
  ];
  const style = {};
  for (const key of keys) {
    if (options[key] !== undefined) style[key] = options[key];
  }
  return Object.keys(style).length ? style : undefined;
}

function createElementMapRecorder(config = {}) {
  const layout = normalizeLayout(config.layout);
  const artifact = compactObject({
    fileName: config.fileName || (config.filePath ? path.basename(config.filePath) : undefined),
    filePath: config.filePath,
    createdAtMs: config.createdAtMs || Date.now(),
    generator: config.generator || 'presentations-skill',
  });
  const slides = [];
  const elementIds = new Set();
  let currentSlide = null;

  function ensureSlide() {
    if (!currentSlide) {
      return startSlide({ slideNumber: slides.length + 1, slideId: `slide-${slides.length + 1}` });
    }
    return currentSlide;
  }

  function startSlide(slideConfig = {}) {
    const slideNumber =
      finiteNumber(slideConfig.slideNumber) && slideConfig.slideNumber > 0
        ? Math.floor(slideConfig.slideNumber)
        : slides.length + 1;
    const slide = compactObject({
      slideNumber,
      slideId: slideConfig.slideId || `slide-${String(slideNumber).padStart(2, '0')}`,
      title: slideConfig.title,
      chapterId: slideConfig.chapterId,
      sectionId: slideConfig.sectionId,
      elements: [],
    });
    slides.push(slide);
    currentSlide = slide;
    return slide;
  }

  function recordElement(input = {}) {
    const slide = ensureSlide();
    const elementId = requireString(input.elementId || input.id, 'elementId');
    if (elementIds.has(elementId)) {
      throw new Error(`Duplicate PPT element map elementId: ${elementId}`);
    }
    elementIds.add(elementId);

    const rectIn = normalizeRect(input.rectIn || input, layout);
    const element = compactObject({
      elementId,
      kind: requireString(input.kind, 'kind'),
      role: input.role,
      text: input.text,
      rectIn,
      normalizedRect: toNormalizedRect(rectIn, layout),
      style: input.style,
      source: input.source,
      pptShapeId: input.pptShapeId,
    });
    slide.elements.push(element);
    return element;
  }

  function toJSON() {
    return {
      schema: 'mavis.ppt_element_map.v1',
      artifact,
      layout,
      slides,
    };
  }

  function writeFile(filePath) {
    const defaultPath = artifact.filePath
      ? artifact.filePath.replace(/(?:\.pptx)?$/i, '.mavis-ppt-map.json')
      : '';
    const targetPath = filePath || defaultPath;
    if (!targetPath) {
      throw new Error('PPT element map writeFile requires a target path');
    }
    fs.mkdirSync(path.dirname(targetPath), { recursive: true });
    fs.writeFileSync(targetPath, `${JSON.stringify(toJSON(), null, 2)}\n`, 'utf8');
    return targetPath;
  }

  return {
    layout,
    startSlide,
    recordElement,
    toJSON,
    writeFile,
  };
}

function addMappedText(slide, recorder, input = {}) {
  const text = input.text;
  const options = {
    ...(input.options || {}),
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
  };
  slide.addText(text, options);
  if (recorder) {
    recorder.recordElement({
      elementId: input.elementId || input.id,
      kind: 'text',
      role: input.role,
      text: Array.isArray(text) ? text.map((part) => part.text || '').join('') : String(text || ''),
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      style: input.style || pickStyle(input.options),
      source: input.source,
    });
  }
}

function addMappedShape(slide, recorder, shapeType, input = {}) {
  const options = {
    ...(input.options || {}),
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
  };
  slide.addShape(shapeType, options);
  if (recorder) {
    recorder.recordElement({
      elementId: input.elementId || input.id,
      kind: 'shape',
      role: input.role,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      style: input.style || pickStyle(input.options),
      source: input.source,
    });
  }
}

function addMappedImage(slide, recorder, input = {}) {
  const options = {
    ...(input.options || {}),
    path: input.path,
    data: input.data,
    x: input.x,
    y: input.y,
    w: input.w,
    h: input.h,
  };
  slide.addImage(options);
  if (recorder) {
    recorder.recordElement({
      elementId: input.elementId || input.id,
      kind: 'image',
      role: input.role,
      x: input.x,
      y: input.y,
      w: input.w,
      h: input.h,
      style: input.style || pickStyle(input.options),
      source: input.source,
    });
  }
}

module.exports = {
  DEFAULT_LAYOUT,
  createElementMapRecorder,
  toNormalizedRect,
  addMappedText,
  addMappedShape,
  addMappedImage,
};
