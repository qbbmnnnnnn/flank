<script setup lang="ts">
import { t } from '../services/i18n';
import { Bold, Code2, Heading2, ImagePlus, Italic, Link2, List, ListChecks } from 'lucide-vue-next';
import { computed, onBeforeUnmount, ref } from 'vue';
import { savedSettings } from '../services/settingsService';
import type { NoteColorId, NoteRecord } from '../contracts/note';
import { noteService } from '../services/noteService';
import { noteColorCss, noteColorPool, pickRandomNoteColor } from '../services/noteColorService';
import MarkdownEditor from './MarkdownEditor.vue';

const props = defineProps<{ note: NoteRecord | null }>();
const emit = defineEmits<{ saved: [payload: { note: NoteRecord; isNew: boolean }] }>();
const isDesktop = '__TAURI_INTERNALS__' in window;
const isNewSession = props.note === null;
const palette = computed(() => noteColorPool(savedSettings.value));
const editorBody = ref<InstanceType<typeof MarkdownEditor> | null>(null);
const titleInput = ref<HTMLInputElement | null>(null);
const draftTarget = ref<NoteRecord | null>(props.note);
const draftTitle = ref(props.note?.title ?? '');
const draftBody = ref(props.note?.body ?? '');
const draftColor = ref<NoteColorId>(props.note?.color ?? pickRandomNoteColor(savedSettings.value));
const saveState = ref<'idle' | 'typing' | 'saving' | 'saved' | 'error'>('idle');
const saveStateLabel = computed(() => ({ idle: '自动保存', typing: '自动保存', saving: '自动保存中…', saved: '已自动保存', error: '保存失败' }[saveState.value]));
let saveTimer: number | undefined;
let saveStateTimer: number | undefined;
let saveQueue: Promise<NoteRecord | null> = Promise.resolve(null);

function setSaveState(state: typeof saveState.value) {
  window.clearTimeout(saveStateTimer);
  saveState.value = state;
  if (state === 'saved') saveStateTimer = window.setTimeout(() => (saveState.value = 'idle'), 1800);
}
function derivedTitle(body: string) {
  const line = body.split('\n').find(value => value.trim()) ?? '';
  return line.replace(/^\s*(?:#{1,6}|[-*>]|☐|☑)\s*/, '').replace(/[*_`~]/g, '').slice(0, 28);
}
async function persistDraft(): Promise<NoteRecord | null> {
  window.clearTimeout(saveTimer);
  saveTimer = undefined;
  // CodeMirror transactions already updated the draft. Never read or normalize editable DOM here.
  const body = draftBody.value;
  if (!draftTitle.value.trim() && !body.trim() && isNewSession && !draftTarget.value) {
    setSaveState('idle');
    return null;
  }
  setSaveState('saving');
  const title = draftTitle.value.trim() || derivedTitle(body) || t('未命名便签');
  const previous = draftTarget.value;
  try {
    let saved: NoteRecord;
    if (isDesktop) {
      saved = previous
        ? await noteService.update({ id: previous.id, title, body, color: draftColor.value, textDirection: previous.textDirection, expectedRevision: previous.revision })
        : await noteService.create({ title, body, color: draftColor.value, textDirection: 'automatic' });
    } else if (previous) {
      saved = { ...previous, title, body, color: draftColor.value, updatedAtMs: Date.now(), revision: previous.revision + 1 };
    } else {
      const now = Date.now();
      saved = { id: crypto.randomUUID(), title, body, color: draftColor.value, createdAtMs: now, updatedAtMs: now, archivedAtMs: null, deletedAtMs: null, sortKey: String(now), textDirection: 'automatic', revision: 1 };
    }
    draftTarget.value = saved;
    setSaveState('saved');
    emit('saved', { note: saved, isNew: previous === null });
    return saved;
  } catch (cause) {
    console.error('Flank: saving the note failed', { color: draftColor.value, cause });
    setSaveState('error');
    return null;
  }
}
function scheduleSave() {
  setSaveState('typing');
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => { saveTimer = undefined; void flushSave(); }, 900);
}
function updateBody(body: string) { draftBody.value = body; scheduleSave(); }
function flushSave(): Promise<NoteRecord | null> {
  saveQueue = saveQueue.then(persistDraft, persistDraft);
  return saveQueue;
}
async function flush(): Promise<'saved' | 'empty' | 'error'> {
  const saved = await flushSave();
  if (saveState.value === 'error') return 'error';
  return saved ? 'saved' : 'empty';
}
function focusTitle() { titleInput.value?.focus(); }
function onTitleKeydown(event: KeyboardEvent) {
  if (event.isComposing || event.keyCode === 229) return;
  if (event.key === 'Enter') { event.preventDefault(); editorBody.value?.focusStart(); }
}
defineExpose({ flush, focusTitle });
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
  <div class="note-editor">
    <header class="editor-header">
      <div class="editor-heading">
        <b>{{ isNewSession ? t('新便签') : t('编辑便签') }}</b>
        <span class="save-state" :class="saveState"><i></i>{{ t(saveStateLabel) }}</span>
      </div>
      <div v-if="isNewSession" class="palette">
        <button v-for="color in palette" :key="color.id" type="button" :class="{ selected: draftColor === color.id }" :style="{ background: noteColorCss(color.id) }" :aria-label="t('选择颜色 {color}', { color: color.name })" @click="draftColor = color.id; scheduleSave()"></button>
      </div>
    </header>
    <input ref="titleInput" v-model="draftTitle" class="editor-title" maxlength="28" :placeholder="t('标题')" :aria-label="t('便签标题')" @input="scheduleSave" @keydown="onTitleKeydown">
    <div class="editor-body-shell">
      <MarkdownEditor ref="editorBody" class="editor-body" :model-value="draftBody" @update:model-value="updateBody" />
    </div>
    <footer class="format-bar" @mousedown.prevent>
      <button type="button" :title="t('插入任务')" @click="editorBody?.insertTask()"><ListChecks /></button><i></i>
      <button type="button" :title="t('标题')" @click="editorBody?.format('heading')"><Heading2 /></button>
      <button type="button" :title="t('粗体（在星号中输入）')" @click="editorBody?.format('bold')"><Bold /></button>
      <button type="button" :title="t('斜体（选中文字，或点击后直接输入）')" @click="editorBody?.format('italic')"><Italic /></button>
      <button type="button" :title="t('切换列表')" @click="editorBody?.format('list')"><List /></button>
      <button type="button" :title="t('行内代码（选中文字，或点击后直接输入）')" @click="editorBody?.format('code')"><Code2 /></button><i></i>
      <button type="button" :title="t('插入链接')" @click="editorBody?.insertLink()"><Link2 /></button>
      <button type="button" :title="t('插入本地图片')" @click="editorBody?.insertImage()"><ImagePlus /></button>
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
.palette{display:flex;flex-wrap:wrap;justify-content:flex-end;gap:7px;max-width:280px}
.palette button{width:18px;height:18px;padding:0;border:2px solid #fff;border-radius:50%;box-shadow:0 0 0 1px #cbd5e1;cursor:pointer;transition:transform .16s ease}
.palette button:hover{transform:scale(1.16)}
.palette button.selected{box-shadow:0 0 0 2px var(--accent);transform:scale(.88)}
.editor-title{width:100%;height:72px;flex:0 0 72px;padding:18px 24px 8px;border:0;outline:0;color:var(--text);background:transparent;font-family:var(--note-font,var(--display));font-size:26px;line-height:1.2}
.editor-title::placeholder{color:#a8b6c9}
.editor-body-shell{flex:1;min-height:0;position:relative}
.editor-title,.editor-body{user-select:text;-webkit-user-select:text}
.editor-body{position:absolute;inset:0;color:#425674;font-family:var(--note-font,var(--display));font-size:var(--note-body-font-size,16px);line-height:1.75}
.format-bar{flex:0 0 54px;padding:0 18px;display:flex;align-items:center;gap:5px;border-top:1px solid var(--border);background:#f8fafc}
.format-bar button{width:32px;height:32px;padding:0;display:grid;place-items:center;border:0;border-radius:8px;color:#64748b;background:transparent;cursor:pointer;font-weight:750}
.format-bar button:hover{color:var(--text);background:#eaf2ff}
.format-bar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}
.format-bar>i{width:1px;height:20px;margin:0 3px;background:var(--border)}
@keyframes editor-pulse{to{opacity:.35;transform:scale(.72)}}
</style>
