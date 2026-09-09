<script setup lang="ts">
import { t } from '../../services/i18n';
import { showNotification } from "../../services/notificationService";
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { savedSettings } from "../../services/settingsService";
import { failureReason } from "../../services/notificationService";
import { guideCopy } from './guide';
import { gsap } from "gsap";
import { Bold, Code2, Heading2, ImagePlus, Italic, Link2, List, ListChecks } from "lucide-vue-next";
import MarkdownEditor from '../../components/MarkdownEditor.vue';
import MarkdownImage from '../../components/MarkdownImage.vue';
import NoteColorPicker from '../../components/NoteColorPicker.vue';
import { openExternalUrl } from '../../services/assetService';

import type { NoteColorId } from "../../contracts/note";
import { noteService } from "../../services/noteService";
import { noteColorPool, notePaperStyle, pickRandomNoteColor } from "../../services/noteColorService";
import {
  DOCK_BRIDGE,
  emitToDock,
  isTauriRuntime,
  listenOnWebview,
  type AnchorSide,
  type DockPanelOpenPayload,
  type DockRailResizePayload,
  type Note,
} from "./bridge";

type EditorMode = "closed" | "preview" | "edit";
type PreviewLine = {
  kind: "heading" | "task" | "list" | "quote" | "image" | "paragraph";
  html: string;
  src?: string;
  alt?: string;
  index: number;
  level?: 1 | 2 | 3;
  checked?: boolean;
};

const root = ref<HTMLElement | null>(null);
const editorBody = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const editorSession = ref(0);
watch(() => savedSettings.value.language, () => {
  if (isPlaceholder.value && activeNote.value) activeNote.value = { ...activeNote.value, ...guideCopy() };
});

const side = ref<AnchorSide>("right");
const open = ref(false);
const edgeStaged = ref(false);
const railWidth = ref(104);
const mode = ref<EditorMode>("closed");
const activeNote = ref<Note | null>(null);
const draftTarget = ref<Note | null>(null);
const draftTitle = ref("");
const draftBody = ref("");
const draftColor = ref<NoteColorId>("lemon");
const isNew = ref(false);
const isPlaceholder = ref(false);
const saveState = ref<"idle" | "typing" | "saving" | "saved" | "error">("idle");

const palette = computed(() => noteColorPool(savedSettings.value));

let saveTimer: number | undefined;
let saveStateTimer: number | undefined;
let panelAnimation: gsap.core.Timeline | undefined;
let imageDialogOpen = false;
let unlistenOpen: (() => void) | undefined;
let unlistenClose: (() => void) | undefined;
let unlistenFocus: (() => void) | undefined;
let unlistenNotesChanged: (() => void) | undefined;
let unlistenRailResize: (() => void) | undefined;
let saveQueue: Promise<Note | null> = Promise.resolve(null);

const previewLines = computed<PreviewLine[]>(() => parseMarkdown(activeNote.value?.body ?? ""));
/** Paper plus the ink contrast decided from the rendered paper color. */
const paperStyle = computed<Record<string, string>>(() => notePaperStyle(mode.value === "edit" ? draftColor.value : activeNote.value?.color ?? "lemon"));

function isReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function inward() {
  return side.value === "left" ? 1 : -1;
}

function setSaveState(state: typeof saveState.value, cause?: unknown) {
  window.clearTimeout(saveStateTimer);
  if (state === "error" && saveState.value !== "error") {
    const reason = failureReason(cause);
    const message = t('便签保存失败，请重试；当前编辑内容已保留');
    showNotification(reason ? `${message} · ${reason}` : message);
  }
  saveState.value = state;
  if (state === "saved") saveStateTimer = window.setTimeout(() => (saveState.value = "idle"), 1800);
}

function requestClose() {
  void emitToDock(DOCK_BRIDGE.requestClose, null);
}

async function settlePanelWindow() {
  if (!("__TAURI_INTERNALS__" in window)) {
    editorBody.value?.requestMeasure();
    return;
  }
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    await invoke("settle_dock_panel", { anchorSide: side.value });
  } catch {
    // Keep the wide, transparent layout if native hit-region shaping fails.
  } finally {
    // Entrance transforms and native window settling change the text's screen coordinates.
    editorBody.value?.requestMeasure();
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
  railWidth.value = payload.dockRailWidth;
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
    editorSession.value++;
    draftColor.value = pickRandomNoteColor(savedSettings.value);
    setSaveState("idle");
    mode.value = "edit";
    open.value = true;
    await nextTick();
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
  const body = draftBody.value;
  if (!draftTitle.value.trim() && !body.trim() && isNew.value && !draftTarget.value) {
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
  } catch (cause) {
    console.error("Flank: saving the note failed", { color: draftColor.value, cause });
    setSaveState("error", cause);
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
  editorSession.value++;
  mode.value = "edit";
  nextTick(() => editorBody.value?.focusStart());
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
// Shared CodeMirror surface (also used by the library editor)
// ---------------------------------------------------------------------------

function updateBody(body: string) {
  draftBody.value = body;
  scheduleSave();
}

function updateColor(color: NoteColorId) {
  if (draftColor.value === color) return;
  draftColor.value = color;
  scheduleSave();
}

function onTitleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') {
    event.preventDefault();
    editorBody.value?.focusStart();
  }
}

function onWindowKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === "Escape") requestClose();
  if (mode.value === "edit" && event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    void flushSave();
  }
}

async function insertDockImage() {
  if (imageDialogOpen) return;
  imageDialogOpen = true;
  try {
    await editorBody.value?.insertImage();
  } finally {
    imageDialogOpen = false;
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
    const image = line.match(/^\s*!\[([^\]]*)\]\((flank-asset:\/\/[a-f\d]{64}|https?:\/\/[^\s)]+)\)\s*$/i);
    if (image) return { kind: "image", html: "", alt: image[1], src: image[2], index };
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

async function onPreviewClick(event: MouseEvent) {
  const link = (event.target as HTMLElement).closest<HTMLAnchorElement>('a[href]');
  if (!link) return;
  event.preventDefault();
  await openExternalUrl(link.href);
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
  } catch (cause) {
    console.error("Flank: toggling the task failed", { color: current.color, cause });
    setSaveState("error", cause);
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
  unlistenRailResize = await listenOnWebview<DockRailResizePayload>(DOCK_BRIDGE.railResize, (payload) => { railWidth.value = payload.railWidth; });
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
      // Opening the native image picker temporarily blurs its owner window.
      // It is not an outside click: keep the editor mounted so the selected
      // asset can be inserted into the original CodeMirror selection.
      if (!focused && open.value && !imageDialogOpen) void emitToDock(DOCK_BRIDGE.blurred, null);
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
  unlistenRailResize?.();
  window.removeEventListener("keydown", onWindowKeydown);
  panelAnimation?.kill();
  if (root.value) gsap.killTweensOf(root.value.querySelectorAll("*"));
});
</script>

<template>
  <main ref="root" class="dock-panel-window" :class="[`dock-${side}`, { open, 'edge-staged': edgeStaged }]" :style="{ '--dock-rail': `${railWidth}px` }">
    <button v-if="open" class="panel-dismiss-layer" type="button" :aria-label="t('关闭便签')" @click="requestClose"></button>
    <article v-if="open && mode !== 'closed'" class="note-panel" :class="[mode, { placeholder: isPlaceholder }]" :style="paperStyle">
      <template v-if="mode === 'preview' && activeNote">
        <header class="panel-header">
          <h1>{{ activeNote.title }}</h1>
          <div v-if="!isPlaceholder" class="panel-actions">
            <button type="button" :aria-label="t('编辑便签')" :title="t('编辑')" @click="editNote"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>
          </div>
        </header>
        <div class="preview-body" @click="onPreviewClick">
          <template v-for="line in previewLines" :key="line.index">
            <component :is="`h${line.level}`" v-if="line.kind === 'heading'" v-html="line.html" />
            <div v-else-if="line.kind === 'task'" class="preview-task" :class="{ done: line.checked }"><button type="button" :disabled="isPlaceholder" :aria-label="line.checked ? t('标记未完成') : t('标记完成')" @click="void toggleTask(line.index)"></button><span v-html="line.html"></span></div>
            <div v-else-if="line.kind === 'list'" class="preview-list"><i></i><span v-html="line.html"></span></div>
            <blockquote v-else-if="line.kind === 'quote'" v-html="line.html" />
            <MarkdownImage v-else-if="line.kind === 'image'" :src="line.src!" :alt="line.alt ?? ''" />
            <p v-else v-html="line.html || '&nbsp;'" />
          </template>
        </div>
      </template>
      <template v-else>
        <header class="editor-header">
          <div><b>{{ isNew ? t('新便签') : t('编辑便签') }}</b><span class="save-state" :class="saveState"><i></i>{{ saveState === "saving" ? t('自动保存中…') : saveState === "saved" ? t('已自动保存') : saveState === "error" ? t('保存失败') : t('自动保存') }}</span></div>
          <NoteColorPicker class="dock-color-picker" :model-value="draftColor" :colors="palette" @update:model-value="updateColor" />
        </header>
        <input v-model="draftTitle" class="editor-title" maxlength="28" :placeholder="t('标题')" @input="scheduleSave" @keydown="onTitleKeydown">
        <div class="editor-body-shell">
          <MarkdownEditor ref="editorBody" :key="editorSession" class="editor-body" :model-value="draftBody" @update:model-value="updateBody" />
        </div>
        <footer class="format-bar" @mousedown.prevent>
          <button type="button" :title="t('插入任务')" @click="editorBody?.insertTask()"><ListChecks /></button><i></i>
          <button type="button" :title="t('标题')" @click="editorBody?.format('heading')"><Heading2 /></button>
          <button type="button" :title="t('粗体（在星号中输入）')" @click="editorBody?.format('bold')"><Bold /></button>
          <button type="button" :title="t('斜体（选中文字，或点击后直接输入）')" @click="editorBody?.format('italic')"><Italic /></button>
          <button type="button" :title="t('切换列表')" @click="editorBody?.format('list')"><List /></button>
          <button type="button" :title="t('行内代码（选中文字，或点击后直接输入）')" @click="editorBody?.format('code')"><Code2 /></button><i></i>
          <button type="button" :title="t('插入链接')" @click="editorBody?.insertLink()"><Link2 /></button>
          <button type="button" :title="t('插入本地图片')" @click="insertDockImage"><ImagePlus /></button>
        </footer>
      </template>
    </article>
  </main>
</template>

<style scoped>
.dock-panel-window{width:100vw;height:100vh;position:relative;overflow:hidden;background:transparent;pointer-events:none;user-select:none;-webkit-user-select:none;font-family:var(--note-font,"Noty Display","Microsoft YaHei",Geist,"Segoe UI",sans-serif)}
.note-panel,.note-panel *{pointer-events:auto}
.panel-dismiss-layer{position:absolute;z-index:2;inset:0;padding:0;border:0;background:transparent;pointer-events:auto;cursor:default}
.note-panel{position:absolute;z-index:3;top:50%;right:0;width:380px;overflow:hidden;will-change:transform,opacity;border:1px solid rgba(255,255,255,.28);border-radius:20px;color:var(--paper-ink,#2c2930);background:var(--paper,#ffe78a);box-shadow:none;transform:translateY(-50%);transform-origin:right center}.dock-left .note-panel{left:0;right:auto;transform-origin:left center}.edge-staged.dock-right .note-panel{right:var(--dock-rail,104px)}.edge-staged.dock-left .note-panel{left:var(--dock-rail,104px)}.note-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(145deg,rgba(255,255,255,.26),transparent 26%,rgba(107,73,25,.05))}
.note-panel.preview{height:min(490px,72vh)}.note-panel.edit{height:min(560px,78vh)}
.panel-header{position:relative;z-index:1;height:64px;padding:0 15px 0 19px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(70,55,30,.11)}.panel-header h1{min-width:0;margin:0;overflow:hidden;color:var(--paper-ink,#29262b);font-size:22px;line-height:1.2;letter-spacing:-.025em;text-overflow:ellipsis;white-space:nowrap;user-select:text;-webkit-user-select:text}.panel-actions{display:flex;gap:6px}.panel-actions button,.panel-close{width:30px;height:30px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;color:var(--paper-ink-soft,rgba(40,35,31,.58));background:rgba(255,255,255,.22);cursor:pointer;transition:background .18s ease,transform .18s ease}.panel-actions button:hover,.panel-close:hover{background:rgba(255,255,255,.42);transform:scale(1.06)}.panel-actions svg,.panel-close svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.preview-body{position:relative;z-index:1;height:calc(100% - 64px);padding:18px 22px 30px;overflow-y:auto;font-size:var(--note-body-font-size,16px);line-height:1.85;font-synthesis:weight style;user-select:text;-webkit-user-select:text;scrollbar-width:thin;scrollbar-color:rgba(70,55,30,.22) transparent}.preview-body p{min-height:1.7em;margin:2px 0}.preview-body h1,.preview-body h2,.preview-body h3{margin:19px 0 8px;color:var(--paper-ink,#29262b);font-weight:800;line-height:1.3}.preview-body h1{font-size:1.55em}.preview-body h2{font-size:1.35em}.preview-body h3{font-size:1.18em}.preview-body :deep(strong){color:var(--paper-ink,#29262b);font-weight:800}.preview-body :deep(em){font-style:italic}.preview-body :deep(code){padding:2px 5px;border-radius:5px;background:rgba(255,255,255,.28);font-family:"Cascadia Code",Consolas,monospace;font-size:.9em}.preview-body :deep(a){color:#315f9f;text-decoration-thickness:1px;text-underline-offset:2px}.preview-body blockquote{margin:8px 0;padding-left:12px;border-left:3px solid var(--paper-ink-soft,rgba(54,48,53,.3));color:var(--paper-ink-soft,rgba(54,48,53,.72))}
.preview-task,.preview-list{display:flex;align-items:flex-start;gap:9px;margin:5px 0}.preview-task button{width:19px;height:19px;flex:0 0 auto;margin-top:6px;padding:0;display:grid;place-items:center;border:1.6px solid var(--paper-ink-soft,rgba(54,48,53,.48));border-radius:6px;color:var(--paper-ink,#fff);background:rgba(255,255,255,.2);cursor:pointer}.preview-task.done button{border-color:#3d985c;background:#4cab69}.preview-task.done button::after{content:"✓";font-size:13px;font-weight:800;line-height:1}.preview-task.done span{opacity:.55;text-decoration:line-through}.preview-list i{width:5px;height:5px;flex:0 0 auto;margin:10px 5px 0 6px;border-radius:50%;background:currentColor;opacity:.58}
.editor-header{position:relative;z-index:3;height:56px;padding:0 14px 0 19px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(70,55,30,.11)}.editor-header>div:first-child{display:flex;align-items:center;gap:9px;white-space:nowrap}.editor-header b{font-size:13px}.save-state{display:inline-flex;align-items:center;gap:6px;color:var(--paper-ink-soft,rgba(45,39,34,.58));font-size:11px;font-weight:650;transition:opacity .18s ease}.save-state.idle,.save-state.typing{opacity:0}.save-state i{width:6px;height:6px;border-radius:50%;background:var(--paper-ink-soft,rgba(45,39,34,.28))}.save-state.saving i{background:#4e7fc9;animation:panel-pulse .7s ease-in-out infinite alternate}.save-state.saved i{background:#3e9b5d}.save-state.error{color:#a33f3f}.save-state.error i{background:#d34f4f}.dock-color-picker{--color-picker-border:rgba(64,54,45,.18);--color-picker-border-active:rgba(64,54,45,.34);--color-picker-ink:var(--paper-ink-soft,rgba(45,39,34,.62));--color-picker-control:rgba(255,255,255,.18);--color-picker-control-hover:rgba(255,255,255,.32)}
.editor-title{position:relative;z-index:1;width:100%;height:78px;padding:20px 22px 10px;border:0;outline:0;color:var(--paper-ink,#29262b);background:transparent;font-size:27px;font-weight:700;line-height:1.2;letter-spacing:-.035em}.editor-title::placeholder{color:var(--paper-ink-soft,rgba(45,39,34,.4))}.editor-body-shell{position:relative;z-index:1;height:calc(100% - 188px);min-height:0}.editor-title,.editor-body{user-select:text;-webkit-user-select:text}.editor-body{position:absolute;inset:0;font-size:var(--note-body-font-size,16px);line-height:1.85;--editor-padding-top:10px;--editor-padding-x:22px;--editor-placeholder:var(--paper-ink-soft,rgba(45,39,34,.4));--editor-scrollbar:rgba(70,55,30,.28)}
.format-bar{position:absolute;z-index:2;left:0;right:0;bottom:0;height:54px;padding:0 18px;display:flex;align-items:center;gap:5px;border-top:1px solid rgba(70,55,30,.1);background:rgba(255,255,255,.12)}.format-bar button{width:32px;height:32px;padding:0;display:grid;place-items:center;border:0;border-radius:8px;color:var(--paper-ink-soft,rgba(43,38,42,.66));background:transparent;cursor:pointer;font-weight:750}.format-bar button:hover{color:#29242a;background:rgba(255,255,255,.36)}.format-bar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.format-bar>i{width:1px;height:20px;margin:0 3px;background:rgba(70,55,30,.13)}.format-bar>span{margin-left:auto;color:rgba(45,39,34,.5);font-size:10px;white-space:nowrap}
@keyframes panel-pulse{to{opacity:.35;transform:scale(.72)}}
@media(max-width:500px){.format-bar>span{display:none}}@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
