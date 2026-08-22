import { getFontString, isRTL } from "@excalidraw/common";

import type { ExcalidrawTextElement } from "./types";

import {
  getInlineFormulaData,
  getInlineFormulaRenderSize,
  getInlineFormulaRuns,
  type InlineFormulaRecord,
} from "./inlineFormula";
import { getTextHeight, getLineWidth } from "./textMeasurements";

const INLINE_TEXT_STYLE_CUSTOM_DATA_KEY = "obsidianInlineTextStyles";

export const INLINE_BOLD_TOGGLE_EVENT = "excalidraw-toggle-inline-bold";

export type InlineBoldRange = {
  start: number;
  end: number;
};

type InlineTextStyleData = {
  version: 1;
  bold: InlineBoldRange[];
};

export type InlineTextRun =
  | {
      type: "text";
      text: string;
      bold: boolean;
      sourceStart: number;
      sourceEnd: number;
    }
  | {
      type: "formula";
      source: string;
      record: InlineFormulaRecord;
      sourceStart: number;
      sourceEnd: number;
    };

const isInlineBoldRange = (value: unknown): value is InlineBoldRange => {
  if (!value || typeof value !== "object") {
    return false;
  }
  const range = value as Partial<InlineBoldRange>;
  return (
    Number.isInteger(range.start) &&
    Number.isInteger(range.end) &&
    (range.start as number) >= 0 &&
    (range.end as number) > (range.start as number)
  );
};

export const normalizeInlineBoldRanges = (
  ranges: readonly InlineBoldRange[],
  textLength = Number.MAX_SAFE_INTEGER,
): InlineBoldRange[] => {
  const normalized = ranges
    .map((range) => ({
      start: Math.max(0, Math.min(textLength, Math.trunc(range.start))),
      end: Math.max(0, Math.min(textLength, Math.trunc(range.end))),
    }))
    .filter((range) => range.end > range.start)
    .sort((a, b) => a.start - b.start || a.end - b.end);

  const merged: InlineBoldRange[] = [];
  for (const range of normalized) {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push({ ...range });
    }
  }
  return merged;
};

export const getInlineBoldRanges = (
  element: Pick<ExcalidrawTextElement, "customData">,
  textLength = Number.MAX_SAFE_INTEGER,
): InlineBoldRange[] => {
  const value = element.customData?.[INLINE_TEXT_STYLE_CUSTOM_DATA_KEY] as
    | Partial<InlineTextStyleData>
    | undefined;
  if (
    value?.version !== 1 ||
    !Array.isArray(value.bold) ||
    !value.bold.every(isInlineBoldRange)
  ) {
    return [];
  }
  return normalizeInlineBoldRanges(value.bold, textLength);
};

export const withInlineBoldRanges = (
  customData: ExcalidrawTextElement["customData"],
  ranges: readonly InlineBoldRange[],
  textLength = Number.MAX_SAFE_INTEGER,
): ExcalidrawTextElement["customData"] => {
  const nextCustomData = { ...customData };
  const normalized = normalizeInlineBoldRanges(ranges, textLength);
  if (normalized.length) {
    nextCustomData[INLINE_TEXT_STYLE_CUSTOM_DATA_KEY] = {
      version: 1,
      bold: normalized,
    } satisfies InlineTextStyleData;
  } else {
    delete nextCustomData[INLINE_TEXT_STYLE_CUSTOM_DATA_KEY];
  }
  return nextCustomData;
};

export const inlineBoldRangesEqual = (
  first: readonly InlineBoldRange[],
  second: readonly InlineBoldRange[],
) =>
  first.length === second.length &&
  first.every(
    (range, index) =>
      range.start === second[index].start && range.end === second[index].end,
  );

export const isInlineRangeBold = (
  ranges: readonly InlineBoldRange[],
  start: number,
  end: number,
): boolean => {
  if (end <= start) {
    return false;
  }
  let cursor = start;
  for (const range of normalizeInlineBoldRanges(ranges)) {
    if (range.end <= cursor) {
      continue;
    }
    if (range.start > cursor) {
      return false;
    }
    cursor = Math.max(cursor, range.end);
    if (cursor >= end) {
      return true;
    }
  }
  return false;
};

export const isInlineOffsetBold = (
  ranges: readonly InlineBoldRange[],
  offset: number,
): boolean =>
  ranges.some((range) => offset > range.start && offset <= range.end);

export const toggleInlineBoldRange = (
  ranges: readonly InlineBoldRange[],
  start: number,
  end: number,
  textLength: number,
): InlineBoldRange[] => {
  const selectionStart = Math.max(0, Math.min(textLength, start));
  const selectionEnd = Math.max(selectionStart, Math.min(textLength, end));
  const current = normalizeInlineBoldRanges(ranges, textLength);
  if (selectionEnd <= selectionStart) {
    return current;
  }

  if (!isInlineRangeBold(current, selectionStart, selectionEnd)) {
    return normalizeInlineBoldRanges(
      [...current, { start: selectionStart, end: selectionEnd }],
      textLength,
    );
  }

  return normalizeInlineBoldRanges(
    current.flatMap((range) => {
      if (range.end <= selectionStart || range.start >= selectionEnd) {
        return [range];
      }
      const pieces: InlineBoldRange[] = [];
      if (range.start < selectionStart) {
        pieces.push({ start: range.start, end: selectionStart });
      }
      if (range.end > selectionEnd) {
        pieces.push({ start: selectionEnd, end: range.end });
      }
      return pieces;
    }),
    textLength,
  );
};

/**
 * Rebases style ranges after a native textarea edit. The textarea exposes
 * only the finished value, so we derive the single changed span from the
 * longest shared prefix and suffix. This covers normal typing, paste,
 * replacement, Backspace and Delete without inserting markup into the text.
 */
export const rebaseInlineBoldRanges = (
  previousText: string,
  nextText: string,
  ranges: readonly InlineBoldRange[],
  forceInsertedBold: boolean | null = null,
): InlineBoldRange[] => {
  if (previousText === nextText) {
    return normalizeInlineBoldRanges(ranges, nextText.length);
  }

  let prefix = 0;
  const sharedLimit = Math.min(previousText.length, nextText.length);
  while (
    prefix < sharedLimit &&
    previousText.charCodeAt(prefix) === nextText.charCodeAt(prefix)
  ) {
    prefix++;
  }

  let suffix = 0;
  while (
    suffix < previousText.length - prefix &&
    suffix < nextText.length - prefix &&
    previousText.charCodeAt(previousText.length - 1 - suffix) ===
      nextText.charCodeAt(nextText.length - 1 - suffix)
  ) {
    suffix++;
  }

  const oldEnd = previousText.length - suffix;
  const newEnd = nextText.length - suffix;
  const delta = newEnd - oldEnd;
  const current = normalizeInlineBoldRanges(ranges, previousText.length);
  const nextRanges: InlineBoldRange[] = [];

  for (const range of current) {
    if (range.end <= prefix) {
      nextRanges.push(range);
      continue;
    }
    if (range.start >= oldEnd) {
      nextRanges.push({ start: range.start + delta, end: range.end + delta });
      continue;
    }
    if (range.start < prefix) {
      nextRanges.push({ start: range.start, end: prefix });
    }
    if (range.end > oldEnd) {
      nextRanges.push({ start: newEnd, end: range.end + delta });
    }
  }

  if (newEnd > prefix) {
    const replacedWasBold =
      oldEnd > prefix && isInlineRangeBold(current, prefix, oldEnd);
    const insertedIsBold =
      forceInsertedBold ??
      (replacedWasBold || isInlineOffsetBold(current, prefix));
    if (insertedIsBold) {
      nextRanges.push({ start: prefix, end: newEnd });
    }
  }

  return normalizeInlineBoldRanges(nextRanges, nextText.length);
};

export const getInlineBoldFontString = (
  element: Pick<ExcalidrawTextElement, "fontFamily" | "fontSize">,
) => `700 ${getFontString(element)}` as ReturnType<typeof getFontString>;

const splitTextRunByBoldRanges = (
  text: string,
  sourceStart: number,
  ranges: readonly InlineBoldRange[],
): InlineTextRun[] => {
  if (!text) {
    return [];
  }
  const sourceEnd = sourceStart + text.length;
  const boundaries = new Set([sourceStart, sourceEnd]);
  for (const range of ranges) {
    if (range.end <= sourceStart || range.start >= sourceEnd) {
      continue;
    }
    boundaries.add(Math.max(sourceStart, range.start));
    boundaries.add(Math.min(sourceEnd, range.end));
  }
  const points = [...boundaries].sort((a, b) => a - b);
  const runs: InlineTextRun[] = [];
  for (let index = 0; index < points.length - 1; index++) {
    const start = points[index];
    const end = points[index + 1];
    runs.push({
      type: "text",
      text: text.slice(start - sourceStart, end - sourceStart),
      bold: isInlineRangeBold(ranges, start, end),
      sourceStart: start,
      sourceEnd: end,
    });
  }
  return runs;
};

export const getInlineTextRuns = (
  text: string,
  sourceStart: number,
  element: Pick<
    ExcalidrawTextElement,
    "customData" | "fontFamily" | "fontSize"
  >,
): InlineTextRun[] => {
  const ranges = getInlineBoldRanges(element, sourceStart + text.length);
  const formulaData = getInlineFormulaData(element);
  const formulaRuns = formulaData
    ? getInlineFormulaRuns(text, formulaData)
    : [{ type: "text" as const, text }];
  const runs: InlineTextRun[] = [];
  let offset = sourceStart;

  for (const run of formulaRuns) {
    if (run.type === "text") {
      runs.push(...splitTextRunByBoldRanges(run.text, offset, ranges));
      offset += run.text.length;
      continue;
    }
    runs.push({
      type: "formula",
      source: run.source,
      record: run.record,
      sourceStart: offset,
      sourceEnd: offset + run.source.length,
    });
    offset += run.source.length;
  }
  return runs;
};

export const getInlineTextLineWidth = (
  runs: readonly InlineTextRun[],
  element: Pick<ExcalidrawTextElement, "fontFamily" | "fontSize">,
): number => {
  const regularFont = getFontString(element);
  const boldFont = getInlineBoldFontString(element);
  return runs.reduce((width, run) => {
    if (run.type === "formula") {
      return (
        width + getInlineFormulaRenderSize(run.record, element.fontSize).width
      );
    }
    return width + getLineWidth(run.text, run.bold ? boldFont : regularFont);
  }, 0);
};

export const hasInlineTextFormatting = (
  element: Pick<ExcalidrawTextElement, "customData">,
) =>
  getInlineBoldRanges(element).length > 0 || !!getInlineFormulaData(element);

export const getInlineTextMetrics = (
  element: ExcalidrawTextElement,
  text: string,
): { width: number; height: number } | null => {
  if (
    element.containerId ||
    !element.autoResize ||
    isRTL(text) ||
    !hasInlineTextFormatting(element)
  ) {
    return null;
  }
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let sourceStart = 0;
  let width = 0;
  for (const line of lines) {
    width = Math.max(
      width,
      getInlineTextLineWidth(getInlineTextRuns(line, sourceStart, element), element),
    );
    sourceStart += line.length + 1;
  }
  return {
    width,
    height: getTextHeight(text || " ", element.fontSize, element.lineHeight),
  };
};
