/**
 * Inserts or edits a MathJax-backed inline formula inside Excalidraw's native
 * textarea without replacing the text editor or any of its typography tools.
 *
 * Author: zsviczian
 * @see https://github.com/zsviczian/obsidian-excalidraw-plugin
 *
 * This action is fork-specific because it delegates formula editing/rendering
 * to the stable Obsidian host plugin without replacing native text editing.
 */

import {
  CaptureUpdateAction,
  findInlineFormulaSourceRange,
  refreshTextDimensions,
  type InlineFormulaSourceRange,
  withInlineFormulaRecord,
} from "@excalidraw/element";
import { isTextElement } from "@excalidraw/element";

import { IconButton } from "../components/IconButton";
import { LaTeXIcon } from "../components/icons";
import { editInlineFormula, t2 } from "../obsidianUtils";

import { register } from "./register";

const getTextEditor = () =>
  document.querySelector<HTMLTextAreaElement>(".excalidraw-wysiwyg");

type InlineFormulaActionData =
  | {
      elementId: string;
      range: InlineFormulaSourceRange;
    }
  | null;

export const actionInsertInlineFormula = register<InlineFormulaActionData>({
  name: "insertInlineFormula",
  label: () => t2("INSERT_INLINE_LATEX"),
  icon: LaTeXIcon,
  trackEvent: false,
  predicate: (_elements, appState) => {
    const element = appState.editingTextElement;
    return !!element && !element.containerId && element.autoResize;
  },
  perform: async (_elements, appState, data, app) => {
    const editor = getTextEditor();
    const directElement = data?.elementId
      ? app.scene.getElement(data.elementId)
      : null;
    const editingElement =
      directElement && isTextElement(directElement) && !directElement.isDeleted
        ? directElement
        : appState.editingTextElement;
    if (
      !editingElement ||
      editingElement.containerId ||
      !editingElement.autoResize ||
      (!data && !editor)
    ) {
      return false;
    }

    const originalText = data
      ? editingElement.rawText ?? editingElement.originalText
      : editor!.value; // zsviczian -- retain text after the modal unmounts the native editor
    const selectionStart = data?.range.start ?? editor!.selectionStart;
    const selectionEnd = data?.range.end ?? editor!.selectionEnd;
    const existingRange = data
      ? findInlineFormulaSourceRange(
          originalText,
          data.range.start,
          data.range.end,
        )
      : findInlineFormulaSourceRange(
          originalText,
          selectionStart,
          selectionEnd,
        );
    if (data && !existingRange) {
      return false;
    }

    const result = await editInlineFormula(existingRange?.latex);
    if (!result) {
      if (editor?.isConnected) {
        window.setTimeout(() => {
          editor.focus();
          editor.setSelectionRange(selectionStart, selectionEnd);
        });
      }
      return false;
    }

    const latestElement = app.scene.getElement(editingElement.id);
    if (!latestElement || !isTextElement(latestElement) || latestElement.isDeleted) {
      return false;
    }

    const replaceStart = existingRange?.start ?? selectionStart;
    const replaceEnd = existingRange?.end ?? selectionEnd;
    const source = `\\(${result.latex}\\)`;
    const nextOriginalText =
      originalText.slice(0, replaceStart) +
      source +
      originalText.slice(replaceEnd);
    const nextCustomData = withInlineFormulaRecord(
      latestElement.customData,
      result,
    );
    const rawDimensions = refreshTextDimensions(
      { ...latestElement, customData: nextCustomData },
      null,
      app.scene.getNonDeletedElementsMap(),
      nextOriginalText,
    );
    if (!rawDimensions) {
      return false;
    }
    // Keep the Obsidian host's raw-text cache in sync. Without this callback,
    // a later double-click restores the pre-formula text from that cache.
    const submitResult = app.props.onBeforeTextSubmit?.(
      latestElement,
      rawDimensions.text,
      nextOriginalText,
      false,
    );
    const nextDisplayedText =
      submitResult?.updatedNextOriginalText ?? nextOriginalText;
    const dimensions = refreshTextDimensions(
      { ...latestElement, customData: nextCustomData },
      null,
      app.scene.getNonDeletedElementsMap(),
      nextDisplayedText,
    ); // zsviczian -- commit directly because the shared modal closes the textarea
    if (!dimensions) {
      return false;
    }
    app.scene.mutateElement(latestElement, {
      originalText: nextDisplayedText,
      rawText: nextOriginalText,
      customData: nextCustomData,
      ...(submitResult
        ? {
            link: submitResult.nextLink,
            hasTextLink: !!submitResult.nextLink,
          }
        : null),
      ...dimensions,
    });

    return {
      elements: app.scene.getElementsIncludingDeleted(),
      appState: {
        openPopup: null,
        editingTextElement: null,
        selectedElementIds: { [latestElement.id]: true },
      },
      captureUpdate: CaptureUpdateAction.IMMEDIATELY,
    };
  },
  PanelComponent: ({ updateData }) => (
    <IconButton
      type="button"
      icon={LaTeXIcon}
      title={t2("INSERT_INLINE_LATEX")}
      aria-label={t2("INSERT_INLINE_LATEX")}
      onClick={() => updateData(null)}
    />
  ),
});
