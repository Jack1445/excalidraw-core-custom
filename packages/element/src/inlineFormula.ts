/**
 * Obsidian-only inline-formula helpers for native Excalidraw text elements.
 *
 * Normal text continues to use Excalidraw's textarea, font metrics, and canvas
 * rendering. Only source ranges written as `\\(...\\)` and backed by rendered
 * formula data in `customData` are treated specially.
 *
 * Author: zsviczian
 * @see https://github.com/zsviczian/obsidian-excalidraw-plugin
 *
 * This module is fork-specific because upstream Excalidraw text elements do not
 * currently support mixed text/formula runs.
 */

import { getFontString, getVerticalOffset, isRTL } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "./types";
import {
  getLineHeightInPx,
  getLineWidth,
  getTextHeight,
} from "./textMeasurements";
import { getWrappedTextLines } from "./textWrapping";

export const INLINE_FORMULA_CUSTOM_DATA_KEY =
  "obsidianInlineFormulas" as const;

export type InlineFormulaRecord = {
  latex: string;
  dataURL: string;
  width: number;
  height: number;
};

export type InlineFormulaData = {
  version: 1;
  items: InlineFormulaRecord[];
};

export type InlineFormulaRenderResult = InlineFormulaRecord;

export type InlineFormulaSourceRange = {
  start: number;
  end: number;
  latex: string;
};

export type InlineFormulaRun =
  | { type: "text"; text: string }
  | {
      type: "formula";
      source: string;
      record: InlineFormulaRecord;
    };

const INLINE_FORMULA_PATTERN = /\\\((.+?)\\\)/g;

const isInlineFormulaRecord = (
  value: unknown,
): value is InlineFormulaRecord => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<InlineFormulaRecord>;
  return (
    typeof candidate.latex === "string" &&
    typeof candidate.dataURL === "string" &&
    typeof candidate.width === "number" &&
    candidate.width > 0 &&
    typeof candidate.height === "number" &&
    candidate.height > 0
  );
};

export const getInlineFormulaData = (
  element: Pick<ExcalidrawTextElement, "customData">,
): InlineFormulaData | null => {
  const value = element.customData?.[INLINE_FORMULA_CUSTOM_DATA_KEY] as
    | Partial<InlineFormulaData>
    | undefined;
  if (
    value?.version !== 1 ||
    !Array.isArray(value.items) ||
    !value.items.every(isInlineFormulaRecord)
  ) {
    return null;
  }
  return value as InlineFormulaData;
};

export const withInlineFormulaRecord = (
  customData: ExcalidrawTextElement["customData"],
  record: InlineFormulaRecord,
): ExcalidrawTextElement["customData"] => {
  const current = getInlineFormulaData({ customData });
  const items = [...(current?.items ?? [])];
  const existingIndex = items.findIndex((item) => item.latex === record.latex);
  if (existingIndex === -1) {
    items.push(record);
  } else {
    items[existingIndex] = record;
  }
  return {
    ...customData,
    [INLINE_FORMULA_CUSTOM_DATA_KEY]: {
      version: 1,
      items,
    } satisfies InlineFormulaData,
  };
};

export const findInlineFormulaSourceRange = (
  text: string,
  selectionStart: number,
  selectionEnd: number,
): InlineFormulaSourceRange | null => {
  INLINE_FORMULA_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_FORMULA_PATTERN.exec(text))) {
    const start = match.index;
    const end = start + match[0].length;
    const selectionTouchesRange =
      selectionStart === selectionEnd
        ? selectionStart >= start && selectionStart <= end
        : selectionStart < end && selectionEnd > start;
    if (selectionTouchesRange) {
      return { start, end, latex: match[1] };
    }
  }
  return null;
};

export const getInlineFormulaRuns = (
  text: string,
  data: InlineFormulaData,
): InlineFormulaRun[] => {
  const records = new Map(data.items.map((item) => [item.latex, item]));
  const runs: InlineFormulaRun[] = [];
  let lastIndex = 0;
  INLINE_FORMULA_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = INLINE_FORMULA_PATTERN.exec(text))) {
    const record = records.get(match[1]);
    if (!record) {
      continue;
    }
    if (match.index > lastIndex) {
      runs.push({ type: "text", text: text.slice(lastIndex, match.index) });
    }
    runs.push({ type: "formula", source: match[0], record });
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) {
    runs.push({ type: "text", text: text.slice(lastIndex) });
  }
  return runs.length ? runs : [{ type: "text", text }];
};

export const hasRenderableInlineFormulaSource = (
  element: Pick<ExcalidrawTextElement, "customData">,
  text: string,
): boolean => {
  const data = getInlineFormulaData(element);
  return !!(
    data &&
    getInlineFormulaRuns(text, data).some((run) => run.type === "formula")
  );
};

export const getInlineFormulaRenderSize = (
  record: InlineFormulaRecord,
  fontSize: number,
) => {
  const height = fontSize;
  return {
    width: (record.width / record.height) * height,
    height,
  };
};

export const getInlineFormulaLineWidth = (
  runs: readonly InlineFormulaRun[],
  element: Pick<ExcalidrawTextElement, "fontFamily" | "fontSize">,
): number => {
  const font = getFontString(element);
  return runs.reduce((width, run) => {
    if (run.type === "text") {
      return width + getLineWidth(run.text, font);
    }
    return width + getInlineFormulaRenderSize(run.record, element.fontSize).width;
  }, 0);
};

/**
 * Returns the source range of the rendered inline formula at the supplied
 * scene point. The calculation intentionally mirrors renderElement.ts so a
 * double-click can edit a formula without first entering the native textarea.
 */
export const findInlineFormulaAtScenePoint = (
  element: ExcalidrawTextElement,
  sceneX: number,
  sceneY: number,
): InlineFormulaSourceRange | null => {
  if (element.containerId || isRTL(element.text)) {
    return null;
  }
  const data = getInlineFormulaData(element);
  if (!data) {
    return null;
  }

  // Text elements rotate around their center. Transform the pointer back into
  // the element's unrotated local coordinate system before testing run bounds.
  const centerX = element.x + element.width / 2;
  const centerY = element.y + element.height / 2;
  const dx = sceneX - centerX;
  const dy = sceneY - centerY;
  const cos = Math.cos(-element.angle);
  const sin = Math.sin(-element.angle);
  const localX = centerX + dx * cos - dy * sin - element.x;
  const localY = centerY + dx * sin + dy * cos - element.y;

  const sourceText = element.rawText ?? element.originalText ?? element.text;
  const font = getFontString(element);
  const lines = getWrappedTextLines(
    sourceText.replace(/\r\n?/g, "\n"),
    font,
    element.autoResize ? Infinity : element.width,
  );
  const lineHeightPx = getLineHeightInPx(
    element.fontSize,
    element.lineHeight,
  );
  const verticalOffset = getVerticalOffset(
    element.fontFamily,
    element.fontSize,
    lineHeightPx,
  );
  const tolerance = Math.max(3, element.fontSize * 0.12);

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const { text: line, start: lineSourceOffset } = lines[lineIndex];
    const runs = getInlineFormulaRuns(line, data);
    if (!runs.some((run) => run.type === "formula")) {
      continue;
    }
    const lineWidth = getInlineFormulaLineWidth(runs, element);
    let cursorX =
      element.textAlign === "center"
        ? (element.width - lineWidth) / 2
        : element.textAlign === "right"
        ? element.width - lineWidth
        : 0;
    const baselineY = lineIndex * lineHeightPx + verticalOffset;
    let runSourceOffset = 0;

    for (const run of runs) {
      if (run.type === "text") {
        cursorX += getLineWidth(run.text, font);
        runSourceOffset += run.text.length;
        continue;
      }
      const size = getInlineFormulaRenderSize(run.record, element.fontSize);
      const formulaTop = baselineY - size.height * 0.8;
      const formulaBottom = formulaTop + size.height;
      if (
        localX >= cursorX - tolerance &&
        localX <= cursorX + size.width + tolerance &&
        localY >= formulaTop - tolerance &&
        localY <= formulaBottom + tolerance
      ) {
        return {
          start: lineSourceOffset + runSourceOffset,
          end: lineSourceOffset + runSourceOffset + run.source.length,
          latex: run.record.latex,
        };
      }
      cursorX += size.width;
      runSourceOffset += run.source.length;
    }
  }
  return null;
};

export const getInlineFormulaTextMetrics = (
  element: ExcalidrawTextElement,
  text: string,
): { width: number; height: number } | null => {
  if (element.containerId || !element.autoResize || isRTL(text)) {
    return null;
  }
  const data = getInlineFormulaData(element);
  if (!data) {
    return null;
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  if (
    !lines.some((line) =>
      getInlineFormulaRuns(line, data).some((run) => run.type === "formula"),
    )
  ) {
    return null;
  }
  const width = lines.reduce(
    (maxWidth, line) =>
      Math.max(
        maxWidth,
        getInlineFormulaLineWidth(getInlineFormulaRuns(line, data), element),
      ),
    0,
  );
  return {
    width,
    height: getTextHeight(text || " ", element.fontSize, element.lineHeight),
  };
};

type ImageEntry = {
  image: HTMLImageElement;
  callbacks: Set<() => void>;
};

const inlineFormulaImages = new Map<string, ImageEntry>();
const imageLoadListeners = new Set<() => void>();

export const subscribeToInlineFormulaImageLoad = (listener: () => void) => {
  imageLoadListeners.add(listener);
  return () => {
    imageLoadListeners.delete(listener);
  };
};

export const getInlineFormulaImage = (
  dataURL: string,
  onLoad?: () => void,
): HTMLImageElement | null => {
  let entry = inlineFormulaImages.get(dataURL);
  if (!entry) {
    const image = new Image();
    entry = { image, callbacks: new Set() };
    inlineFormulaImages.set(dataURL, entry);
    image.onload = () => {
      entry?.callbacks.forEach((callback) => callback());
      entry?.callbacks.clear();
      imageLoadListeners.forEach((listener) => listener());
    };
    image.src = dataURL;
  }
  if (entry.image.complete && entry.image.naturalWidth > 0) {
    return entry.image;
  }
  if (onLoad) {
    entry.callbacks.add(onLoad);
  }
  return null;
};

export const getInlineFormulaLineHeight = (
  element: Pick<ExcalidrawTextElement, "fontSize" | "lineHeight">,
) => getLineHeightInPx(element.fontSize, element.lineHeight);
