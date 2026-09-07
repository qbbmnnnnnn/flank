<script setup lang="ts">
import { t } from '../../services/i18n';
import { showNotification } from "../../services/notificationService";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { savedSettings } from "../../services/settingsService";
import { guideCopy } from './guide';
import { gsap } from "gsap";

import type { NoteColor } from "../../contracts/note";
import { noteService } from "../../services/noteService";
import {
  DOCK_BRIDGE,
  emitToDock,
  isTauriRuntime,
  listenOnWebview,
  noteColorCss,
  type AnchorSide,
  type DockPanelOpenPayload,
  type Note,
} from "./bridge";

type EditorMode = "closed" | "preview" | "edit";
type PreviewLine = {
  kind: "heading" | "task" | "list" | "quote" | "paragraph";
  html: string;
  index: number;
  level?: 1 | 2 | 3;
  checked?: boolean;
};

const root = ref<HTMLElement | null>(null);
const editorBody = ref<HTMLElement | null>(null);
watch(() => savedSettings.value.language, () => {
  if (isPlaceholder.value && activeNote.value) activeNote.value = { ...activeNote.value, ...guideCopy() };
  editorBody.value?.querySelectorAll('.editor-task-box').forEach((box) => box.setAttribute('aria-label', t(box.classList.contains('is-checked') ? '标记为未完成' : '标记为完成')));
});

const side = ref<AnchorSide>("right");
const open = ref(false);
const edgeStaged = ref(false);
const mode = ref<EditorMode>("closed");
const activeNote = ref<Note | null>(null);
const draftTarget = ref<Note | null>(null);
const draftTitle = ref("");
const draftBody = ref("");
const draftColor = ref<NoteColor>("lemon");
const isNew = ref(false);
const isPlaceholder = ref(false);
const saveState = ref<"idle" | "typing" | "saving" | "saved" | "error">("idle");

const palette: NoteColor[] = ["lemon", "peach", "rose", "lilac", "sky", "mint"]; 

let saveTimer: number | undefined;
let saveStateTimer: number | undefined;
let panelAnimation: gsap.core.Timeline | undefined;
let unlistenOpen: (() => void) | undefined;
let unlistenClose: (() => void) | undefined;
let unlistenFocus: (() => void) | undefined;
let unlistenNotesChanged: (() => void) | undefined;
let saveQueue: Promise<Note | null> = Promise.resolve(null);

const previewLines = computed<PreviewLine[]>(() => parseMarkdown(activeNote.value?.body ?? ""));
const paper = computed(() => noteColorCss(mode.value === "edit" ? draftColor.value : activeNote.value?.color ?? "lemon"));

function isReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function inward() {
  return side.value === "left" ? 1 : -1;
}

function setSaveState(state: typeof saveState.value) {
  window.clearTimeout(saveStateTimer);
  if (state === "error" && saveState.value !== "error") showNotification(t('便签保存失败，请重试；当前编辑内容已保留'));
  saveState.value = state;
  if (state === "saved") saveStateTimer = window.setTimeout(() => (saveState.value = "idle"), 1800);
}

function requestClose() {
  void emitToDock(DOCK_BRIDGE.requestClose, null);
}

async function settlePanelWindow() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("settle_dock_panel", { anchorSide: side.value });
  } catch {
    // Keep the wide, transparent layout if native hit-region shaping fails.
  }
}

async function preparePanelAnimation() {
  if (!("__TAURI_INTERNALS__" in window)) return;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("prepare_dock_panel_animation");
  } catch {
    // The exit animation can still run with the current hit region.
  }
}

// ---------------------------------------------------------------------------
// Entrance / exit
// ---------------------------------------------------------------------------

function playPanelEntrance(panel: HTMLElement) {
  panelAnimation?.kill();
  gsap.killTweensOf(panel);

  if (isReducedMotion()) {
    gsap.set(panel, { clearProps: "transform,opacity,visibility" });
    void settlePanelWindow();
    return;
  }

  const direction = inward();
  const offscreenX = -(panel.offsetWidth + 128) * direction;
  gsap.set(panel, {
    x: offscreenX,
    rotation: -9 * direction,
    autoAlpha: 0,
    transformOrigin: side.value === "left" ? "left 42%" : "right 42%",
  });
  panelAnimation = gsap.timeline({ defaults: { overwrite: "auto" } })
    .set(panel, { autoAlpha: 1 })
    .to(panel, { x: 12 * direction, rotation: 2.2 * direction, duration: .56, ease: "power3.out" })
    .to(panel, { x: 0, rotation: 0, duration: .3, ease: "back.out(1.7)", clearProps: "transform,opacity,visibility", onComplete: () => void settlePanelWindow() });
}

async function animateOutCurrent() {
  const panel = root.value?.querySelector<HTMLElement>(".note-panel");
  if (!panel || isReducedMotion()) return;
  panelAnimation?.kill();
  panelAnimation = undefined;
  gsap.killTweensOf(panel);
  const direction = inward();
  const offscreenX = -(panel.offsetWidth + 128) * direction;
  await gsap.timeline({ defaults: { overwrite: "auto" } })
    .to(panel, { x: 10 * direction, rotation: -1.5 * direction, duration: .1, ease: "power1.out" })
    .to(panel, { x: offscreenX, rotation: 8 * direction, autoAlpha: 0, duration: .28, ease: "power3.in" });
}

async function playPanelExit() {
  const panel = root.value?.querySelector<HTMLElement>(".note-panel");
  if (!panel || isReducedMotion()) return;
  panelAnimation?.kill();
  panelAnimation = undefined;
  gsap.killTweensOf(panel);
  await gsap.to(panel, { autoAlpha: 0, x: 42 * -inward(), rotation: 2.5 * -inward(), duration: .2, ease: "power2.in" });
}

// ---------------------------------------------------------------------------
// Open / close (driven by the rail)
// ---------------------------------------------------------------------------

async function handleOpen(payload: DockPanelOpenPayload) {
  side.value = payload.anchorSide;
  edgeStaged.value = true;
  const wasClosed = !open.value;

  if (payload.isNew) {
    isPlaceholder.value = false;
    if (mode.value === "edit") {
      await flushSave();
      if (saveState.value === "error") return;
    }
    activeNote.value = null;
    draftTarget.value = null;
    isNew.value = true;
    draftTitle.value = "";
    draftBody.value = "";
    draftColor.value = palette[Math.floor(Math.random() * palette.length)] ?? "lemon";
    setSaveState("idle");
    mode.value = "edit";
    open.value = true;
    await nextTick();
    setEditorBodyValue("");
    root.value?.querySelector<HTMLInputElement>(".editor-title")?.focus();
    const panel = root.value?.querySelector<HTMLElement>(".note-panel");
    if (panel && wasClosed) playPanelEntrance(panel);
    else void settlePanelWindow();
    return;
  }

  const note = payload.note;
  if (!note) return;

  if (payload.sameNote) {
    void settlePanelWindow();
    if (payload.isPlaceholder) return;
    if (mode.value === "preview" && activeNote.value?.id === note.id) {
      editNote();
    } else if (mode.value === "edit" && activeNote.value?.id === note.id) {
      await finishEditing();
    } else {
      open.value = true;
      mode.value = "preview";
      activeNote.value = note;
    }
    return;
  }

  const isSwitch = open.value && activeNote.value !== null && activeNote.value.id !== note.id;
  if (mode.value === "edit") {
    await flushSave();
    if (saveState.value === "error") return;
  }

  if (isSwitch) await animateOutCurrent();

  activeNote.value = note;
  draftTarget.value = null;
  isNew.value = false;
  isPlaceholder.value = Boolean(payload.isPlaceholder);
  mode.value = "preview";
  open.value = true;
  await nextTick();
  const panel = root.value?.querySelector<HTMLElement>(".note-panel");
  if (panel && (wasClosed || isSwitch)) playPanelEntrance(panel);
  else void settlePanelWindow();
}

async function handleClose() {
  if (!open.value) return;
  if (mode.value === "edit") {
    await flushSave();
    if (saveState.value === "error") return;
  }
  await preparePanelAnimation();
  await playPanelExit();
  open.value = false;
  edgeStaged.value = false;
  mode.value = "closed";
  activeNote.value = null;
  draftTarget.value = null;
  isNew.value = false;
  isPlaceholder.value = false;
  draftTitle.value = "";
  draftBody.value = "";
}

// ---------------------------------------------------------------------------
// Editing
// ---------------------------------------------------------------------------

function scheduleSave() {
  if (mode.value !== "edit") return;
  syncDraftBody();
  setSaveState("typing");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => void flushSave(), 900);
}

function derivedTitle(body: string) {
  const line = body.split("\n").find((value) => value.trim()) ?? "";
  return line.replace(/^\s*(?:#{1,6}|[-*>]|☐|☑)\s*/, "").replace(/[*_`~]/g, "").slice(0, 28);
}

async function persistDraft(): Promise<Note | null> {
  window.clearTimeout(saveTimer);
  syncDraftBody();
  const body = draftBody.value.replace(/^\n+|\n+$/g, "");
  if (!draftTitle.value.trim() && !body && isNew.value && !draftTarget.value) {
    setSaveState("idle");
    return null;
  }

  setSaveState("saving");
  const title = draftTitle.value.trim() || derivedTitle(body) || t('未命名便签');
  const previous = draftTarget.value;
  try {
    let saved: Note;
    if (isTauriRuntime()) {
      saved = previous
        ? await noteService.update({ id: previous.id, title, body, color: draftColor.value, textDirection: previous.textDirection, expectedRevision: previous.revision })
        : await noteService.create({ title, body, color: draftColor.value, textDirection: "automatic" });
    } else if (previous) {
      saved = { ...previous, title, body, color: draftColor.value, updatedAtMs: Date.now(), revision: previous.revision + 1 };
    } else {
      const now = Date.now();
      saved = { id: crypto.randomUUID(), title, body, color: draftColor.value, createdAtMs: now, updatedAtMs: now, archivedAtMs: null, deletedAtMs: null, sortKey: String(now), textDirection: "automatic", revision: 1 };
    }
    draftTarget.value = saved;
    activeNote.value = saved;
    isNew.value = false;
    setSaveState("saved");
    await emitToDock(DOCK_BRIDGE.save, { note: saved, isNew: previous === null });
    return saved;
  } catch {
    setSaveState("error");
    return null;
  }
}

function flushSave(): Promise<Note | null> {
  saveQueue = saveQueue.then(persistDraft, persistDraft);
  return saveQueue;
}

function editNote() {
  if (!activeNote.value || isPlaceholder.value) return;
  draftTarget.value = activeNote.value;
  draftTitle.value = activeNote.value.title;
  draftBody.value = activeNote.value.body;
  draftColor.value = activeNote.value.color;
  isNew.value = false;
  setSaveState("idle");
  mode.value = "edit";
  nextTick(() => {
    setEditorBodyValue(draftBody.value);
    focusEditorLine(editorBody.value?.querySelector<HTMLElement>(".editor-line") ?? null, 0);
  });
}

async function finishEditing() {
  const saved = await flushSave();
  if (saveState.value === "error") return;
  if (!saved) {
    mode.value = "closed";
    open.value = false;
    requestClose();
    return;
  }
  activeNote.value = saved;
  draftTarget.value = null;
  isNew.value = false;
  mode.value = "preview";
  await nextTick();
  const panel = root.value?.querySelector<HTMLElement>(".note-panel");
  if (panel) gsap.fromTo(panel, { autoAlpha: .7, scale: .96 }, { autoAlpha: 1, scale: 1, duration: isReducedMotion() ? 0 : .24, ease: "power2.out" });
}

// ---------------------------------------------------------------------------
// Editor surface helpers (contenteditable)
// ---------------------------------------------------------------------------

function focusBodyFromTitle() {
  const firstLine = editorBody.value?.querySelector<HTMLElement>(":scope > .editor-line") ?? null;
  focusEditorLine(firstLine, 0);
}

function createEditorLine(text = "", task = false, checked = false) {
  const line = document.createElement("div");
  line.className = `editor-line${task ? " is-task" : ""}`;
  if (task) {
    const checkbox = document.createElement("button");
    checkbox.type = "button";
    checkbox.className = `editor-task-box${checked ? " is-checked" : ""}`;
    checkbox.contentEditable = "false";
    checkbox.setAttribute("aria-checked", String(checked));
    checkbox.setAttribute("aria-label", checked ? t('标记为未完成') : t('标记为完成'));
    line.appendChild(checkbox);
  }
  const copy = document.createElement("span");
  copy.className = "editor-line-copy";
  copy.contentEditable = "true";
  copy.spellcheck = true;
  if (text) copy.textContent = text;
  else copy.appendChild(document.createElement("br"));
  line.appendChild(copy);
  return line;
}

function setEditorBodyValue(value: string) {
  if (!editorBody.value) return;
  const fragment = document.createDocumentFragment();
  const lines = value ? value.split("\n") : [""];
  lines.forEach((raw) => {
    const task = raw.match(/^\s*(☐|☑)\s?(.*)$/);
    fragment.appendChild(createEditorLine(task ? task[2] : raw, Boolean(task), task?.[1] === "☑"));
  });
  editorBody.value.replaceChildren(fragment);
  editorBody.value.classList.toggle("is-empty", !value);
}

function getEditorBodyValue() {
  if (!editorBody.value) return draftBody.value;
  return [...editorBody.value.querySelectorAll<HTMLElement>(":scope > .editor-line")].map((line) => {
    const copy = line.querySelector<HTMLElement>(".editor-line-copy");
    const text = (copy?.innerText || "").replace(/\n+$/g, "");
    if (!line.classList.contains("is-task")) return text;
    return `${line.querySelector(".editor-task-box")?.classList.contains("is-checked") ? "☑" : "☐"} ${text}`;
  }).join("\n");
}

function syncDraftBody() {
  if (mode.value !== "edit" || !editorBody.value) return;
  draftBody.value = getEditorBodyValue();
  editorBody.value.classList.toggle("is-empty", !draftBody.value);
}

function currentEditorLine() {
  const selection = getSelection();
  const anchor = selection?.anchorNode;
  const node = anchor?.nodeType === Node.TEXT_NODE ? anchor.parentElement : anchor as HTMLElement | null;
  return node?.closest<HTMLElement>(".editor-line") ?? null;
}

function lineCaretOffset(line: HTMLElement) {
  const copy = line.querySelector<HTMLElement>(".editor-line-copy");
  const selection = getSelection();
  if (!copy || !selection?.rangeCount || !copy.contains(selection.anchorNode)) return (copy?.innerText || "").length;
  const range = selection.getRangeAt(0).cloneRange();
  range.selectNodeContents(copy);
  range.setEnd(selection.anchorNode!, selection.anchorOffset);
  return range.toString().length;
}

function focusEditorLine(line: HTMLElement | null, offset = 0) {
  if (!line) return;
  const copy = line.querySelector<HTMLElement>(".editor-line-copy");
  if (!copy) return;
  if (copy.querySelector("br")) copy.replaceChildren(document.createTextNode(""));
  const node = copy.firstChild || copy.appendChild(document.createTextNode(""));
  copy.focus();
  const range = document.createRange();
  range.setStart(node, Math.min(offset, node.textContent?.length ?? 0));
  range.collapse(true);
  const selection = getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

function insertTask() {
  let line = currentEditorLine();
  if (!line) {
    const blank = [...(editorBody.value?.querySelectorAll<HTMLElement>(":scope > .editor-line") ?? [])].find((item) => !(item.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").trim());
    line = createEditorLine("", true);
    if (blank) blank.replaceWith(line);
    else editorBody.value?.appendChild(line);
  } else if (!line.classList.contains("is-task") && !(line.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").trim()) {
    const replacement = createEditorLine("", true);
    line.replaceWith(replacement);
    line = replacement;
  } else {
    const next = createEditorLine("", true);
    line.after(next);
    line = next;
  }
  focusEditorLine(line);
  scheduleSave();
}

function applyMarkdown(format: "heading" | "bold" | "italic" | "list" | "code") {
  const selection = getSelection();
  let line = currentEditorLine();
  if (!line) {
    const lines = [...(editorBody.value?.querySelectorAll<HTMLElement>(":scope > .editor-line") ?? [])];
    line = [...lines].reverse().find((item) => (item.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").trim()) ?? lines[0] ?? null;
    focusEditorLine(line, (line?.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").length);
  }
  if (!line || !selection) return;
  const copy = line.querySelector<HTMLElement>(".editor-line-copy");
  if (!copy) return;

  if (format === "heading" || format === "list") {
    const prefix = format === "heading" ? "## " : "- ";
    const current = (copy.innerText || "").replace(/\n+$/g, "");
    const existing = format === "heading" ? /^#{1,3}\s+/ : /^\s*[-*+]\s+/;
    const match = current.match(existing);
    const offset = lineCaretOffset(line);
    const nextText = match ? current.slice(match[0].length) : prefix + current;
    copy.textContent = nextText;
    focusEditorLine(line, match ? Math.max(0, offset - match[0].length) : offset + prefix.length);
  } else {
    const formats = { bold: ["**", "**"], italic: ["*", "*"], code: ["`", "`"] } as const;
    const [prefix, suffix] = formats[format];
    const range = selection.rangeCount ? selection.getRangeAt(0) : null;
    if (!range || !editorBody.value?.contains(range.commonAncestorContainer)) return;
    const selected = selection.toString();
    range.deleteContents();
    const node = document.createTextNode(`${prefix}${selected}${suffix}`);
    range.insertNode(node);
    if (selected) {
      range.setStart(node, prefix.length);
      range.setEnd(node, prefix.length + selected.length);
    } else {
      range.setStart(node, prefix.length);
      range.collapse(true);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }
  copy.focus();
  scheduleSave();
}

function onEditorKeydown(event: KeyboardEvent) {
  const line = currentEditorLine();
  if (!line) return;
  const copy = line.querySelector<HTMLElement>(".editor-line-copy");
  const text = (copy?.innerText || "").replace(/\n+$/g, "");
  const offset = lineCaretOffset(line);
  if (event.key === "Enter" && !event.shiftKey && !event.ctrlKey && !event.metaKey) {
    event.preventDefault();
    const list = !line.classList.contains("is-task") && text.match(/^(\s*[-*+]\s+)/);
    if (line.classList.contains("is-task") && !text.trim()) {
      const replacement = createEditorLine("");
      line.replaceWith(replacement);
      focusEditorLine(replacement);
    } else if (list && !text.slice(list[1].length).trim()) {
      if (copy) copy.replaceChildren(document.createElement("br"));
      focusEditorLine(line, 0);
    } else {
      const before = text.slice(0, offset);
      const after = text.slice(offset);
      if (copy) {
        copy.textContent = before;
        if (!before) copy.appendChild(document.createElement("br"));
      }
      const next = createEditorLine(`${list ? list[1] : ""}${after}`, line.classList.contains("is-task"));
      line.after(next);
      focusEditorLine(next, list ? list[1].length : 0);
    }
    scheduleSave();
    return;
  }
  if (event.key === "Backspace" && offset === 0) {
    const previous = line.previousElementSibling as HTMLElement | null;
    if (previous?.classList.contains("editor-line")) {
      event.preventDefault();
      const previousCopy = previous.querySelector<HTMLElement>(".editor-line-copy");
      const previousText = (previousCopy?.innerText || "").replace(/\n+$/g, "");
      if (previousCopy) previousCopy.textContent = previousText + text;
      line.remove();
      focusEditorLine(previous, previousText.length);
      scheduleSave();
    } else if (line.classList.contains("is-task") && !text) {
      event.preventDefault();
      const replacement = createEditorLine("");
      line.replaceWith(replacement);
      focusEditorLine(replacement, 0);
      scheduleSave();
    }
  }
}

function onEditorPaste(event: ClipboardEvent) {
  event.preventDefault();
  const text = event.clipboardData?.getData("text/plain").replace(/\r/g, "") ?? "";
  const line = currentEditorLine();
  if (!line || !text.includes("\n")) {
    document.execCommand("insertText", false, text);
    scheduleSave();
    return;
  }
  const copy = line.querySelector<HTMLElement>(".editor-line-copy");
  const original = (copy?.innerText || "").replace(/\n+$/g, "");
  const offset = lineCaretOffset(line);
  const parts = text.split("\n");
  if (copy) copy.textContent = original.slice(0, offset) + (parts.shift() ?? "");
  let cursor = line;
  parts.forEach((part, index) => {
    const raw = index === parts.length - 1 ? part + original.slice(offset) : part;
    const task = raw.match(/^\s*(☐|☑)\s?(.*)$/);
    const next = createEditorLine(task ? task[2] : raw, Boolean(task), task?.[1] === "☑");
    cursor.after(next);
    cursor = next;
  });
  focusEditorLine(cursor, Math.max(0, (cursor.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").length - original.slice(offset).length));
  scheduleSave();
}

function onEditorPointerDown(event: PointerEvent) {
  if ((event.target as HTMLElement).closest(".editor-task-box")) event.preventDefault();
}

function onEditorClick(event: MouseEvent) {
  const target = event.target as HTMLElement;
  const checkbox = target.closest<HTMLElement>(".editor-task-box");
  if (checkbox) {
    const checked = checkbox.classList.toggle("is-checked");
    checkbox.setAttribute("aria-checked", String(checked));
    checkbox.setAttribute("aria-label", checked ? t('标记为未完成') : t('标记为完成'));
    scheduleSave();
    return;
  }

  const lines = [...(editorBody.value?.querySelectorAll<HTMLElement>(":scope > .editor-line") ?? [])];
  const clickedLine = target.closest<HTMLElement>(".editor-line");
  if (clickedLine) {
    if ((clickedLine.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").length) return;
    focusEditorLine(clickedLine, 0);
    return;
  }

  const destination = lines.at(-1) ?? null;
  const offset = (destination?.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").replace(/\n+$/g, "").length;
  focusEditorLine(destination, offset);
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") requestClose();
  if (mode.value === "edit" && event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    void flushSave();
  }
}

// ---------------------------------------------------------------------------
// Markdown preview
// ---------------------------------------------------------------------------

function escapeHtml(value: string) {
  return value.replace(/[&<>\"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]!);
}

function renderLine(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function parseMarkdown(body: string): PreviewLine[] {
  return body.split("\n").map((line, index) => {
    const task = line.match(/^\s*(☐|☑)\s?(.*)$/) || line.match(/^\s*-\s*\[([ xX])\]\s?(.*)$/);
    if (task) return { kind: "task", html: renderLine(task[2] || ""), checked: task[1] === "☑" || /x/i.test(task[1]), index };
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) return { kind: "heading", html: renderLine(heading[2]), level: heading[1].length as 1 | 2 | 3, index };
    const list = line.match(/^\s*[-*+]\s+(.*)$/);
    if (list) return { kind: "list", html: renderLine(list[1]), index };
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) return { kind: "quote", html: renderLine(quote[1]), index };
    return { kind: "paragraph", html: renderLine(line), index };
  });
}

async function toggleTask(index: number) {
  if (!activeNote.value || isPlaceholder.value) return;
  const lines = activeNote.value.body.split("\n");
  if (/^\s*☐/.test(lines[index])) lines[index] = lines[index].replace("☐", "☑");
  else if (/^\s*☑/.test(lines[index])) lines[index] = lines[index].replace("☑", "☐");
  else if (/^\s*-\s*\[\s\]/.test(lines[index])) lines[index] = lines[index].replace(/\[\s\]/, "[x]");
  else lines[index] = lines[index].replace(/\[[xX]\]/, "[ ]");
  const current = activeNote.value;
  const body = lines.join("\n");
  try {
    const saved = isTauriRuntime()
      ? await noteService.update({ id: current.id, title: current.title, body, color: current.color, textDirection: current.textDirection, expectedRevision: current.revision })
      : { ...current, body, updatedAtMs: Date.now(), revision: current.revision + 1 };
    activeNote.value = saved;
    await emitToDock(DOCK_BRIDGE.save, { note: saved, isNew: false });
  } catch {
    setSaveState("error");
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

onMounted(async () => {
  document.documentElement.classList.add("dock-document");
  document.body.classList.add("dock-document");

  unlistenOpen = await listenOnWebview<DockPanelOpenPayload>(DOCK_BRIDGE.open, (payload) => void handleOpen(payload));
  unlistenClose = await listenOnWebview<null>(DOCK_BRIDGE.close, () => void handleClose());
  window.addEventListener("keydown", onWindowKeydown);

  try {
    const { listen } = await import("@tauri-apps/api/event");
    unlistenNotesChanged = await listen("notes:changed", async () => {
      if (!open.value || !activeNote.value || mode.value === "edit") return;
      const persisted = await noteService.list({ scope: "active", query: "" });
      const current = persisted.find((note) => note.id === activeNote.value?.id);
      if (current) activeNote.value = current;
      else requestClose();
    });
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    const panelWindow = getCurrentWindow();
    unlistenFocus = await panelWindow.onFocusChanged(({ payload: focused }) => {
      // Blur-close is owned by the rail: it needs a short grace period to
      // distinguish "clicked another tab" from "clicked away entirely".
      if (!focused && open.value) void emitToDock(DOCK_BRIDGE.blurred, null);
    });
  } catch {
    // Browser preview has no native panel window.
  }
});

onUnmounted(() => {
  document.documentElement.classList.remove("dock-document");
  document.body.classList.remove("dock-document");
  window.clearTimeout(saveTimer);
  window.clearTimeout(saveStateTimer);
  unlistenOpen?.();
  unlistenClose?.();
  unlistenFocus?.();
  unlistenNotesChanged?.();
  window.removeEventListener("keydown", onWindowKeydown);
  panelAnimation?.kill();
  if (root.value) gsap.killTweensOf(root.value.querySelectorAll("*"));
});
</script>

<template>
  <main ref="root" class="dock-panel-window" :class="[`dock-${side}`, { open, 'edge-staged': edgeStaged }]">
    <button v-if="open" class="panel-dismiss-layer" type="button" :aria-label="t('关闭便签')" @click="requestClose"></button>
    <article v-if="open && mode !== 'closed'" class="note-panel" :class="[mode, { placeholder: isPlaceholder }]" :style="{ '--paper': paper }">
      <template v-if="mode === 'preview' && activeNote">
        <header class="panel-header">
          <h1>{{ activeNote.title }}</h1>
          <div v-if="!isPlaceholder" class="panel-actions">
            <button type="button" :aria-label="t('编辑便签')" :title="t('编辑')" @click="editNote"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>
          </div>
        </header>
        <div class="preview-body">
          <template v-for="line in previewLines" :key="line.index">
            <component :is="`h${line.level}`" v-if="line.kind === 'heading'" v-html="line.html" />
            <div v-else-if="line.kind === 'task'" class="preview-task" :class="{ done: line.checked }"><button type="button" :disabled="isPlaceholder" :aria-label="line.checked ? t('标记未完成') : t('标记完成')" @click="void toggleTask(line.index)"></button><span v-html="line.html"></span></div>
            <div v-else-if="line.kind === 'list'" class="preview-list"><i></i><span v-html="line.html"></span></div>
            <blockquote v-else-if="line.kind === 'quote'" v-html="line.html" />
            <p v-else v-html="line.html || '&nbsp;'" />
          </template>
        </div>
      </template>
      <template v-else>
        <header class="editor-header">
          <div><b>{{ isNew ? t('新便签') : t('编辑便签') }}</b><span class="save-state" :class="saveState"><i></i>{{ saveState === "saving" ? t('自动保存中…') : saveState === "saved" ? t('已自动保存') : saveState === "error" ? t('保存失败') : t('自动保存') }}</span></div>
          <div v-if="isNew" class="palette"><button v-for="color in palette" :key="color" type="button" :class="{ selected: draftColor === color }" :style="{ background: noteColorCss(color) }" :aria-label="t('选择颜色 {color}', { color })" @click="draftColor = color; scheduleSave()"></button></div>
        </header>
        <input v-model="draftTitle" class="editor-title" maxlength="28" :placeholder="t('标题')" @input="scheduleSave" @keydown.enter.prevent="focusBodyFromTitle">
        <div class="editor-body-shell">
          <div ref="editorBody" class="editor-body is-empty" role="textbox" aria-multiline="true" :aria-label="t('便签内容，支持 Markdown')" :data-placeholder="t('随便写点什么。。。')" @input="scheduleSave" @keydown="onEditorKeydown" @paste="onEditorPaste" @pointerdown="onEditorPointerDown" @click="onEditorClick"></div>
        </div>
        <footer class="format-bar" @pointerdown.prevent>
          <button type="button" :title="t('插入任务')" @click="insertTask"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7.5 12 3 3 6-7"/></svg></button><i></i>
          <button type="button" :title="t('标题')" @click="applyMarkdown('heading')">H</button>
          <button type="button" :title="t('粗体（在星号中输入）')" @click="applyMarkdown('bold')"><b>B</b></button>
          <button type="button" :title="t('斜体（选中文字，或点击后直接输入）')" @click="applyMarkdown('italic')"><em>I</em></button>
          <button type="button" :title="t('切换列表')" @click="applyMarkdown('list')"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg></button>
          <button type="button" :title="t('行内代码（选中文字，或点击后直接输入）')" @click="applyMarkdown('code')">&lt;/&gt;</button>
        </footer>
      </template>
    </article>
  </main>
</template>

<style scoped>
.dock-panel-window{width:100vw;height:100vh;position:relative;overflow:hidden;background:transparent;pointer-events:none;user-select:none;-webkit-user-select:none;font-family:"Noty Display","Microsoft YaHei",Geist,"Segoe UI",sans-serif}
.note-panel,.note-panel *{pointer-events:auto}
.panel-dismiss-layer{position:absolute;z-index:2;inset:0;padding:0;border:0;background:transparent;pointer-events:auto;cursor:default}
.note-panel{position:absolute;z-index:3;top:50%;right:0;width:380px;overflow:hidden;will-change:transform,opacity;border:1px solid rgba(255,255,255,.28);border-radius:20px;color:#2c2930;background:var(--paper,#ffe78a);box-shadow:none;transform:translateY(-50%);transform-origin:right center}.dock-left .note-panel{left:0;right:auto;transform-origin:left center}.edge-staged.dock-right .note-panel{right:104px}.edge-staged.dock-left .note-panel{left:104px}.note-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(145deg,rgba(255,255,255,.26),transparent 26%,rgba(107,73,25,.05))}
.note-panel.preview{height:min(490px,72vh)}.note-panel.edit{height:min(560px,78vh)}
.panel-header{position:relative;z-index:1;height:64px;padding:0 15px 0 19px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(70,55,30,.11)}.panel-header h1{min-width:0;margin:0;overflow:hidden;color:#29262b;font-size:22px;line-height:1.2;letter-spacing:-.025em;text-overflow:ellipsis;white-space:nowrap}.panel-actions{display:flex;gap:6px}.panel-actions button,.panel-close{width:30px;height:30px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;color:rgba(40,35,31,.58);background:rgba(255,255,255,.22);cursor:pointer;transition:background .18s ease,transform .18s ease}.panel-actions button:hover,.panel-close:hover{background:rgba(255,255,255,.42);transform:scale(1.06)}.panel-actions svg,.panel-close svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.preview-body{position:relative;z-index:1;height:calc(100% - 64px);padding:18px 22px 30px;overflow-y:auto;font-size:17px;line-height:1.85;scrollbar-width:thin;scrollbar-color:rgba(70,55,30,.22) transparent}.preview-body p{min-height:1.7em;margin:2px 0}.preview-body h1,.preview-body h2,.preview-body h3{margin:19px 0 8px;line-height:1.3}.preview-body h1{font-size:23px}.preview-body h2{font-size:20px}.preview-body h3{font-size:17px}.preview-body :deep(code){padding:2px 5px;border-radius:5px;background:rgba(255,255,255,.28);font-family:"Cascadia Code",Consolas,monospace;font-size:.9em}.preview-body :deep(a){color:#315f9f;text-decoration-thickness:1px;text-underline-offset:2px}.preview-body blockquote{margin:8px 0;padding-left:12px;border-left:3px solid rgba(54,48,53,.3);color:rgba(54,48,53,.72)}
.preview-task,.preview-list{display:flex;align-items:flex-start;gap:9px;margin:5px 0}.preview-task button{width:19px;height:19px;flex:0 0 auto;margin-top:6px;padding:0;display:grid;place-items:center;border:1.6px solid rgba(54,48,53,.48);border-radius:6px;color:#fff;background:rgba(255,255,255,.2);cursor:pointer}.preview-task.done button{border-color:#3d985c;background:#4cab69}.preview-task.done button::after{content:"✓";font-size:13px;font-weight:800;line-height:1}.preview-task.done span{opacity:.55;text-decoration:line-through}.preview-list i{width:5px;height:5px;flex:0 0 auto;margin:10px 5px 0 6px;border-radius:50%;background:currentColor;opacity:.58}
.editor-header{position:relative;z-index:1;height:56px;padding:0 14px 0 19px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(70,55,30,.11)}.editor-header>div:first-child{display:flex;align-items:center;gap:9px;white-space:nowrap}.editor-header b{font-size:13px}.save-state{display:inline-flex;align-items:center;gap:6px;color:rgba(45,39,34,.58);font-size:11px;font-weight:650;transition:opacity .18s ease}.save-state.idle,.save-state.typing{opacity:0}.save-state i{width:6px;height:6px;border-radius:50%;background:rgba(45,39,34,.28)}.save-state.saving i{background:#4e7fc9;animation:panel-pulse .7s ease-in-out infinite alternate}.save-state.saved i{background:#3e9b5d}.save-state.error{color:#a33f3f}.save-state.error i{background:#d34f4f}.palette{margin-left:auto;display:flex;gap:7px}.palette button{width:18px;height:18px;padding:0;border:2px solid rgba(255,255,255,.62);border-radius:50%;box-shadow:none;cursor:pointer;transition:transform .16s ease}.palette button:hover{transform:scale(1.16)}.palette button.selected{border-color:rgba(43,38,35,.7);transform:scale(.88)}
.editor-title{position:relative;z-index:1;width:100%;height:78px;padding:20px 22px 10px;border:0;outline:0;color:#29262b;background:transparent;font-size:27px;font-weight:700;line-height:1.2;letter-spacing:-.035em}.editor-title::placeholder{color:rgba(45,39,34,.4)}.editor-body-shell{position:relative;z-index:1;height:calc(100% - 188px);min-height:0}.editor-title,.editor-body{user-select:text;-webkit-user-select:text}.editor-body{position:absolute;inset:0;padding:10px 22px 20px;overflow-y:auto;outline:0;font-size:17px;line-height:1.85;scrollbar-width:thin;scrollbar-color:rgba(70,55,30,.28) transparent}.editor-body.is-empty::before{content:attr(data-placeholder);position:absolute;left:22px;top:10px;color:rgba(45,39,34,.4);pointer-events:none}.editor-body :deep(.editor-line){min-height:31.45px;display:block;overflow-wrap:anywhere;white-space:pre-wrap}.editor-body :deep(.editor-line.is-task){display:grid;grid-template-columns:19px minmax(0,1fr);align-items:start;gap:9px}.editor-body :deep(.editor-line-copy){min-width:0;outline:0;overflow-wrap:anywhere;white-space:pre-wrap}.editor-body :deep(.editor-task-box){width:19px;height:19px;margin-top:6px;padding:0;display:grid;place-items:center;border:1.6px solid rgba(54,48,53,.5);border-radius:6px;color:#fff;background:transparent;cursor:pointer}.editor-body :deep(.editor-task-box.is-checked){border-color:#3d985c;background:#4cab69}.editor-body :deep(.editor-task-box.is-checked::after){content:"✓";font-size:13px;font-weight:800;line-height:1}
.format-bar{position:absolute;z-index:2;left:0;right:0;bottom:0;height:54px;padding:0 18px;display:flex;align-items:center;gap:5px;border-top:1px solid rgba(70,55,30,.1);background:rgba(255,255,255,.12)}.format-bar button{width:32px;height:32px;padding:0;display:grid;place-items:center;border:0;border-radius:8px;color:rgba(43,38,42,.66);background:transparent;cursor:pointer;font-weight:750}.format-bar button:hover{color:#29242a;background:rgba(255,255,255,.36)}.format-bar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.format-bar>i{width:1px;height:20px;margin:0 3px;background:rgba(70,55,30,.13)}.format-bar>span{margin-left:auto;color:rgba(45,39,34,.5);font-size:10px;white-space:nowrap}
@keyframes panel-pulse{to{opacity:.35;transform:scale(.72)}}
@media(max-width:500px){.palette{gap:4px}.palette button{width:14px;height:14px}.format-bar>span{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
