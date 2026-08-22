import {
  CaptureUpdateAction,
  INLINE_BOLD_TOGGLE_EVENT,
} from "@excalidraw/element";
import { KEYS } from "@excalidraw/common";

import { IconButton } from "../components/IconButton";
import { FontFamilyBoldIcon } from "../components/icons";
import { t } from "../i18n";

import { register } from "./register";

const getTextEditor = () =>
  document.querySelector<HTMLTextAreaElement>(".excalidraw-wysiwyg");

export const actionToggleInlineBold = register<null>({
  name: "toggleInlineBold",
  label: "labels.bold",
  icon: FontFamilyBoldIcon,
  trackEvent: false,
  predicate: (_elements, appState) => {
    const element = appState.editingTextElement;
    return !!element && !element.containerId && element.autoResize;
  },
  keyTest: (event, appState) =>
    !!appState.editingTextElement &&
    event[KEYS.CTRL_OR_CMD] &&
    !event.altKey &&
    (event.code === "KeyB" || event.key.toLowerCase() === "b"),
  perform: (_elements, appState) => {
    const editor = getTextEditor();
    if (!editor || !appState.editingTextElement) {
      return false;
    }
    editor.dispatchEvent(new CustomEvent(INLINE_BOLD_TOGGLE_EVENT));
    return {
      appState: null,
      elements: null,
      captureUpdate: CaptureUpdateAction.NEVER,
    };
  },
  PanelComponent: ({ updateData }) => (
    <IconButton
      type="button"
      icon={FontFamilyBoldIcon}
      title={`${t("labels.bold")} (Ctrl+B)`}
      aria-label={`${t("labels.bold")} (Ctrl+B)`}
      onClick={() => updateData(null)}
    />
  ),
});
