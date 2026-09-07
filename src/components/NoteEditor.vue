<script setup lang="ts">
import { t } from '../services/i18n';
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { savedSettings } from "../services/settingsService";

import type { NoteColor, NoteRecord } from "../contracts/note";
import { noteService } from "../services/noteService";

const props = defineProps<{
  /** `null` when creating a brand-new note. */
  note: NoteRecord | null;
}>();

const emit = defineEmits<{
  saved: [payload: { note: NoteRecord; isNew: boolean }];
}>();

const isDesktop = "__TAURI_INTERNALS__" in window;
const isNewSession = props.note === null;

const palette: NoteColor[] = ["lemon", "peach", "rose", "lilac", "sky", "mint"];
const root = ref<HTMLElement | null>(null);
const editorBody = ref<HTMLElement | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
watch(() => savedSettings.value.language, () => {
  editorBody.value?.querySelectorAll('.editor-task-box').forEach((box) => box.setAttribute('aria-label', t(box.classList.contains('is-checked') ? '标记为未完成' : '标记为完成')));
});

const draftTarget = ref<NoteRecord | null>(props.note);
const draftTitle = ref(props.note?.title ?? "");
const draftBody = ref(props.note?.body ?? "");
const draftColor = ref<NoteColor>(props.note?.color ?? palette[Math.floor(Math.random() * palette.length)] ?? "lemon");
const saveState = ref<"idle" | "typing" | "saving" | "saved" | "error">("idle");

const saveStateLabel = computed(() => ({
  idle: "自动保存",
  typing: "自动保存",
  saving: "自动保存中…",
  saved: "已自动保存",
  error: "保存失败",
}[saveState.value]));

let saveTimer: number | undefined;
let saveStateTimer: number | undefined;
let saveQueue: Promise<NoteRecord | null> = Promise.resolve(null);

function setSaveState(state: typeof saveState.value) {
  window.clearTimeout(saveStateTimer);
  saveState.value = state;
  if (state === "saved") saveStateTimer = window.setTimeout(() => (saveState.value = "idle"), 1800);
}

function derivedTitle(body: string) {
  const line = body.split("\n").find((value) => value.trim()) ?? "";
  return line.replace(/^\s*(?:#{1,6}|[-*>]|☐|☑)\s*/, "").replace(/[*_`~]/g, "").slice(0, 28);
}

// ---------------------------------------------------------------------------
// Persistence (debounced auto-save)
// ---------------------------------------------------------------------------

async function persistDraft(): Promise<NoteRecord | null> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  syncDraftBody();
  const body = draftBody.value.replace(/^\n+|\n+$/g, "");
  if (!draftTitle.value.trim() && !body && isNewSession && !draftTarget.value) {
    setSaveState("idle");
    return null;
  }

  setSaveState("saving");
  const title = draftTitle.value.trim() || derivedTitle(body) || t('未命名便签');
  const previous = draftTarget.value;
  try {
    let saved: NoteRecord;
    if (isDesktop) {
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
    setSaveState("saved");
    emit("saved", { note: saved, isNew: previous === null });
    return saved;
  } catch {
    setSaveState("error");
    return null;
  }
}

function scheduleSave() {
  syncDraftBody();
  setSaveState("typing");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    saveTimer = undefined;
    void flushSave();
  }, 900);
}

function flushSave(): Promise<NoteRecord | null> {
  saveQueue = saveQueue.then(persistDraft, persistDraft);
  return saveQueue;
}

async function flush(): Promise<"saved" | "empty" | "error"> {
  const saved = await flushSave();
  if (saveState.value === "error") return "error";
  return saved ? "saved" : "empty";
}

function focusTitle() {
  titleInput.value?.focus();
}

defineExpose({ flush, focusTitle });

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
  if (!editorBody.value) return;
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

function onTitleKeydown(event: KeyboardEvent) {
  if (event.key === "Enter") {
    event.preventDefault();
    focusBodyFromTitle();
  }
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

onMounted(() => {
  setEditorBodyValue(draftBody.value);
});

onBeforeUnmount(() => {
  if (saveTimer !== undefined) {
    window.clearTimeout(saveTimer);
    saveTimer = undefined;
    void flushSave();
  }
  window.clearTimeout(saveStateTimer);
});
</script>

<template>
  <div ref="root" class="note-editor">
    <header class="editor-header">
      <div class="editor-heading">
        <b>{{ isNewSession ? t('新便签') : t('编辑便签') }}</b>
        <span class="save-state" :class="saveState"><i></i>{{ t(saveStateLabel) }}</span>
      </div>
      <div v-if="isNewSession" class="palette">
        <button v-for="color in palette" :key="color" type="button" :class="{ selected: draftColor === color }" :style="{ background: `var(--note-${color})` }" :aria-label="t('选择颜色 {color}', { color })" @click="draftColor = color; scheduleSave()"></button>
      </div>
    </header>
    <input ref="titleInput" v-model="draftTitle" class="editor-title" maxlength="28" :placeholder="t('标题')" :aria-label="t('便签标题')" @input="scheduleSave" @keydown="onTitleKeydown">
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
  </div>
</template>

<style scoped>
.note-editor{flex:1;min-height:0;display:flex;flex-direction:column;color:var(--text);background:var(--surface)}
.editor-header{height:56px;flex:0 0 56px;padding:0 18px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid var(--border)}
.editor-heading{display:flex;align-items:center;gap:9px;white-space:nowrap}
.editor-heading b{font-family:var(--display);font-size:13px;font-weight:400;color:#64748b}
.save-state{display:inline-flex;align-items:center;gap:6px;color:#8296b3;font-family:var(--display);font-size:11px;font-weight:650;transition:opacity .18s ease}
.save-state.idle,.save-state.typing{opacity:0}
.save-state i{width:6px;height:6px;border-radius:50%;background:#9aa9bf}
.save-state.saving i{background:#4e7fc9;animation:editor-pulse .7s ease-in-out infinite alternate}
.save-state.saved i{background:#3e9b5d}
.save-state.error{color:#c0392b}.save-state.error i{background:#d34f4f}
.palette{display:flex;gap:7px}
.palette button{width:18px;height:18px;padding:0;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #cbd5e1;cursor:pointer;transition:transform .16s ease}
.palette button:hover{transform:scale(1.16)}
.palette button.selected{box-shadow:0 0 0 2px var(--accent);transform:scale(.88)}
.editor-title{width:100%;height:72px;flex:0 0 72px;padding:18px 24px 8px;border:0;outline:0;color:var(--text);background:transparent;font-family:var(--display);font-size:26px;line-height:1.2}
.editor-title::placeholder{color:#a8b6c9}
.editor-body-shell{flex:1;min-height:0;position:relative}
.editor-title,.editor-body{user-select:text;-webkit-user-select:text}
.editor-body{position:absolute;inset:0;padding:6px 24px 20px;overflow-y:auto;outline:0;color:#425674;font-family:var(--display);font-size:18px;line-height:1.75;scrollbar-width:thin;scrollbar-color:#cbd8e9 transparent}
.editor-body.is-empty::before{content:attr(data-placeholder);position:absolute;left:24px;top:6px;color:#a8b6c9;pointer-events:none}
.editor-body :deep(.editor-line){min-height:31.5px;display:block;overflow-wrap:anywhere;white-space:pre-wrap}
.editor-body :deep(.editor-line.is-task){display:grid;grid-template-columns:19px minmax(0,1fr);align-items:start;gap:9px}
.editor-body :deep(.editor-line-copy){min-width:0;outline:0;overflow-wrap:anywhere;white-space:pre-wrap}
.editor-body :deep(.editor-task-box){width:19px;height:19px;margin-top:6px;padding:0;display:grid;place-items:center;border:1.6px solid rgba(54,48,53,.5);border-radius:6px;color:#fff;background:transparent;cursor:pointer}
.editor-body :deep(.editor-task-box.is-checked){border-color:#3d985c;background:#4cab69}
.editor-body :deep(.editor-task-box.is-checked::after){content:"✓";font-size:13px;font-weight:800;line-height:1}
.format-bar{flex:0 0 54px;padding:0 18px;display:flex;align-items:center;gap:5px;border-top:1px solid var(--border);background:#f8fafc}
.format-bar button{width:32px;height:32px;padding:0;display:grid;place-items:center;border:0;border-radius:8px;color:#64748b;background:transparent;cursor:pointer;font-weight:750}
.format-bar button:hover{color:var(--text);background:#eaf2ff}
.format-bar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.format-bar>i{width:1px;height:20px;margin:0 3px;background:var(--border)}
@keyframes editor-pulse{to{opacity:.35;transform:scale(.72)}}
</style>
