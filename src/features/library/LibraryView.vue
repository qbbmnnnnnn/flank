<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { gsap } from "gsap";
import type { CreateNoteInput, NoteColor, NoteRecord, NoteScope, TextDirection } from "../../contracts/note";
import { noteService } from "../../services/noteService";
import SettingsView from "../settings/SettingsView.vue";

const scope = ref<NoteScope>("active");
const query = ref("");
const notes = ref<NoteRecord[]>([]);
const selectedId = ref<string | null>(null);
const loading = ref(false);
const saving = ref(false);
const error = ref("");
const toast = ref("");
const deleteTarget = ref<NoteRecord | null>(null);
const editorOpen = ref(false);
const settingsOpen = ref(false);
const viewMode = ref<"grid" | "list">((localStorage.getItem("flank-library-view") as "grid" | "list") || "grid");
const searchInput = ref<HTMLInputElement | null>(null);
const libraryRoot = ref<HTMLElement | null>(null);
const noteList = ref<HTMLElement | null>(null);
let animationContext: gsap.Context | undefined;
let unlistenNotesChanged: (() => void) | undefined;
let searchTimer: number | undefined;
let toastTimer: number | undefined;

const now = Date.now();
const demoNotes = ref<NoteRecord[]>([
  { id: "demo-1", title: "今日灵感", body: "让工具像家具一样安静，像朋友一样及时。\n\n- [ ] 调整首页留白\n- [x] 完成资料库结构", color: "lemon", createdAtMs: now - 86400000 * 2, updatedAtMs: now - 1000 * 60 * 18, archivedAtMs: null, deletedAtMs: null, sortKey: "1", textDirection: "automatic", revision: 1 },
  { id: "demo-2", title: "产品待办", body: "高优先级\n\n- [x] 纵向 Dock 动效\n- [ ] 快速捕获\n- [ ] 导入导出", color: "peach", createdAtMs: now - 86400000 * 6, updatedAtMs: now - 3600000 * 3, archivedAtMs: null, deletedAtMs: null, sortKey: "2", textDirection: "automatic", revision: 1 },
  { id: "demo-3", title: "阅读清单", body: "《设计中的设计》\n《制造消费者》\n《微交互》", color: "mint", createdAtMs: now - 86400000 * 20, updatedAtMs: now - 86400000 * 3, archivedAtMs: now - 86400000 * 2, deletedAtMs: null, sortKey: "3", textDirection: "automatic", revision: 2 },
  { id: "demo-4", title: "旧会议记录", body: "已经整理进项目文档。", color: "sky", createdAtMs: now - 86400000 * 35, updatedAtMs: now - 86400000 * 5, archivedAtMs: null, deletedAtMs: now - 86400000 * 5, sortKey: "4", textDirection: "automatic", revision: 2 },
  { id: "demo-5", title: "周末采购", body: "燕麦奶、咖啡豆、番茄\n给阳台补一盆薄荷。", color: "mint", createdAtMs: now - 86400000, updatedAtMs: now - 3600000 * 6, archivedAtMs: null, deletedAtMs: null, sortKey: "5", textDirection: "automatic", revision: 1 },
  { id: "demo-6", title: "会议速记", body: "主页以内容为中心；设置收进弹窗；保留卡片与列表两种浏览方式。", color: "lilac", createdAtMs: now - 86400000 * 3, updatedAtMs: now - 86400000, archivedAtMs: null, deletedAtMs: null, sortKey: "6", textDirection: "automatic", revision: 1 },
  { id: "demo-7", title: "一句话", body: "好的工具不是吸引注意力，而是在需要时恰好出现。", color: "sky", createdAtMs: now - 86400000 * 4, updatedAtMs: now - 86400000 * 2, archivedAtMs: null, deletedAtMs: null, sortKey: "7", textDirection: "automatic", revision: 1 },
  { id: "demo-8", title: "旅行清单", body: "- [x] 充电器\n- [x] 耳机\n- [ ] 相机电池\n- [ ] 随身水杯", color: "rose", createdAtMs: now - 86400000 * 5, updatedAtMs: now - 86400000 * 3, archivedAtMs: null, deletedAtMs: null, sortKey: "8", textDirection: "automatic", revision: 1 },
]);
const isDesktop = "__TAURI_INTERNALS__" in window;

const sections: Array<{ id: NoteScope; label: string; caption: string }> = [
  { id: "active", label: "展示中", caption: "正在便签栏显示" },
  { id: "archived", label: "已归档", caption: "暂时收起的便签" },
  { id: "deleted", label: "最近删除", caption: "保留 30 天" },
];
const counts = reactive<Record<NoteScope, number>>({ active: 0, archived: 0, deleted: 0 });
const selected = computed(() => notes.value.find((note) => note.id === selectedId.value) ?? null);
const draft = reactive<CreateNoteInput>({ title: "", body: "", color: "lemon", textDirection: "automatic" });
const isNew = ref(false);
const hasChanges = computed(() => isNew.value || (!!selected.value && (draft.title !== selected.value.title || draft.body !== selected.value.body || draft.color !== selected.value.color || draft.textDirection !== selected.value.textDirection)));

function scopedDemo(target: NoteScope, search = "") {
  const needle = search.trim().toLocaleLowerCase();
  return demoNotes.value.filter((note) => {
    const inScope = target === "deleted" ? note.deletedAtMs !== null : target === "archived" ? note.deletedAtMs === null && note.archivedAtMs !== null : note.deletedAtMs === null && note.archivedAtMs === null;
    return inScope && (!needle || note.title.toLocaleLowerCase().includes(needle) || note.body.toLocaleLowerCase().includes(needle));
  });
}

async function list(target: NoteScope, search = "") {
  return isDesktop ? noteService.list({ scope: target, query: search }) : scopedDemo(target, search);
}

async function refreshCounts() {
  const result = await Promise.all(sections.map((section) => list(section.id)));
  sections.forEach((section, index) => (counts[section.id] = result[index].length));
}

async function loadNotes(preferredId?: string) {
  loading.value = true;
  error.value = "";
  try {
    notes.value = await list(scope.value, query.value);
    const nextId = preferredId && notes.value.some((note) => note.id === preferredId) ? preferredId : null;
    selectNote(nextId);
    await refreshCounts();
  } catch {
    error.value = "无法读取本地便签，请稍后重试。";
    notes.value = [];
    selectedId.value = null;
  } finally {
    loading.value = false;
  }
}

function selectNote(id: string | null, open = false) {
  selectedId.value = id;
  isNew.value = false;
  editorOpen.value = open && id !== null;
  const note = notes.value.find((item) => item.id === id);
  if (note) Object.assign(draft, { title: note.title, body: note.body, color: note.color, textDirection: note.textDirection });
}

function chooseScope(next: NoteScope) {
  if (scope.value === next) return;
  scope.value = next;
  query.value = "";
  void loadNotes();
}

function createNote() {
  scope.value = "active";
  query.value = "";
  selectedId.value = null;
  isNew.value = true;
  editorOpen.value = true;
  Object.assign(draft, { title: "", body: "", color: "lemon" as NoteColor, textDirection: "automatic" as TextDirection });
  void nextTick(() => document.querySelector<HTMLInputElement>(".note-title-input")?.focus());
}

async function saveNote() {
  if (!hasChanges.value || saving.value) return;
  saving.value = true;
  try {
    let result: NoteRecord;
    if (isDesktop) {
      result = isNew.value
        ? await noteService.create({ ...draft })
        : await noteService.update({ ...draft, id: selected.value!.id, expectedRevision: selected.value!.revision });
    } else if (isNew.value) {
      result = { id: crypto.randomUUID(), ...draft, createdAtMs: Date.now(), updatedAtMs: Date.now(), archivedAtMs: null, deletedAtMs: null, sortKey: "0", revision: 1 };
      demoNotes.value.unshift(result);
    } else {
      result = { ...selected.value!, ...draft, updatedAtMs: Date.now(), revision: selected.value!.revision + 1 };
      demoNotes.value = demoNotes.value.map((note) => note.id === result.id ? result : note);
    }
    isNew.value = false;
    showToast("便签已保存");
    await loadNotes(result.id);
  } catch {
    showToast("保存失败，便签可能已在其他窗口修改");
  } finally {
    saving.value = false;
  }
}

async function mutate(note: NoteRecord, action: "archive" | "unarchive" | "delete" | "restore") {
  try {
    if (isDesktop) {
      const input = { id: note.id, expectedRevision: note.revision };
      if (action === "archive") await noteService.archive(input);
      else if (action === "unarchive") await noteService.unarchive(input);
      else if (action === "delete") await noteService.delete(input);
      else await noteService.restoreDeleted(input);
    } else {
      demoNotes.value = demoNotes.value.map((item) => item.id !== note.id ? item : {
        ...item,
        archivedAtMs: action === "archive" ? Date.now() : action === "unarchive" ? null : item.archivedAtMs,
        deletedAtMs: action === "delete" ? Date.now() : action === "restore" ? null : item.deletedAtMs,
        revision: item.revision + 1,
      });
    }
    showToast(action === "archive" ? "已归档" : action === "unarchive" ? "已恢复到展示中" : action === "delete" ? "已移到最近删除" : note.archivedAtMs ? "已恢复到归档" : "已恢复到展示中");
    editorOpen.value = false;
    await loadNotes();
  } catch {
    showToast("操作失败，请刷新后重试");
  }
}

async function permanentlyDelete() {
  const note = deleteTarget.value;
  if (!note) return;
  try {
    if (isDesktop) await noteService.permanentlyDelete({ id: note.id, expectedRevision: note.revision });
    else demoNotes.value = demoNotes.value.filter((item) => item.id !== note.id);
    deleteTarget.value = null;
    showToast("便签已永久删除");
    await loadNotes();
  } catch {
    deleteTarget.value = null;
    showToast("永久删除失败，请刷新后重试");
  }
}

async function setViewMode(mode: "grid" | "list") {
  if (viewMode.value === mode) return;
  viewMode.value = mode;
  localStorage.setItem("flank-library-view", mode);
  await nextTick();
  const items = noteList.value?.querySelectorAll<HTMLElement>(".note-row");
  if (!items?.length || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  gsap.fromTo(items, { autoAlpha: 0, y: 12, scale: .975 }, { autoAlpha: 1, y: 0, scale: 1, duration: .38, stagger: .035, ease: "power3.out", clearProps: "transform,opacity,visibility" });
}

function animateCardFocus(id: string) {
  if (viewMode.value !== "grid" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const items = [...(noteList.value?.querySelectorAll<HTMLElement>(".note-row") ?? [])];
  const activeIndex = items.findIndex((item) => item.dataset.noteId === id);
  items.forEach((item, index) => {
    const distance = Math.abs(index - activeIndex);
    gsap.to(item, {
      y: distance === 0 ? -10 : distance === 1 ? -4 : 0,
      scale: distance === 0 ? 1.045 : distance === 1 ? 1.018 : 1,
      rotation: distance === 0 ? 0 : undefined,
      duration: .34,
      ease: "power3.out",
      overwrite: "auto",
    });
  });
}

function resetCardFocus() {
  const items = noteList.value?.querySelectorAll<HTMLElement>(".note-row");
  if (!items?.length) return;
  gsap.to(items, { y: 0, scale: 1, duration: .42, ease: "power3.out", overwrite: "auto", clearProps: "transform" });
}

function showToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 2300);
}

function formatTime(value: number) {
  const diff = Date.now() - value;
  if (diff < 60000) return "刚刚";
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  if (diff < 86400000 * 7) return `${Math.floor(diff / 86400000)} 天前`;
  return new Intl.DateTimeFormat("zh-CN", { month: "short", day: "numeric" }).format(value);
}

function taskProgress(body: string) {
  const tasks = [...body.matchAll(/^\s*[-*]?\s*\[([ xX])\]/gm)];
  if (!tasks.length) return "";
  const done = tasks.filter((match) => match[1].toLowerCase() === "x").length;
  return `${done}/${tasks.length} 项完成`;
}

function retention(note: NoteRecord) {
  if (!note.deletedAtMs) return "";
  const days = Math.max(0, Math.ceil((note.deletedAtMs + 30 * 86400000 - Date.now()) / 86400000));
  return days === 0 ? "即将永久删除" : `${days} 天后永久删除`;
}

function onListKeydown(event: KeyboardEvent) {
  if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key) || !notes.value.length) return;
  event.preventDefault();
  const current = Math.max(0, notes.value.findIndex((note) => note.id === selectedId.value));
  const index = event.key === "Home" ? 0 : event.key === "End" ? notes.value.length - 1 : event.key === "ArrowDown" ? Math.min(notes.value.length - 1, current + 1) : Math.max(0, current - 1);
  selectNote(notes.value[index].id);
  void nextTick(() => document.querySelector<HTMLElement>(`[data-note-id="${notes.value[index].id}"]`)?.focus());
}

watch(query, () => {
  window.clearTimeout(searchTimer);
  searchTimer = window.setTimeout(() => void loadNotes(selectedId.value ?? undefined), 120);
});

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    searchInput.value?.focus();
  }
}

onMounted(async () => {
  await loadNotes();
  if (isDesktop) {
    const { listen } = await import("@tauri-apps/api/event");
    unlistenNotesChanged = await listen("notes:changed", () => void loadNotes(selectedId.value ?? undefined));
  }
  window.addEventListener("keydown", handleGlobalKeydown);
  if (libraryRoot.value) {
    animationContext = gsap.context(() => {
      if (!window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
        gsap.from(".library-sidebar", { x: -18, autoAlpha: 0, duration: .5, ease: "power3.out" });
        gsap.from(".index-header, .library-search, .result-summary", { y: 9, autoAlpha: 0, duration: .42, stagger: .055, ease: "power2.out" });
      }
    }, libraryRoot.value);
  }
});

onUnmounted(() => {
  animationContext?.revert();
  unlistenNotesChanged?.();
  window.removeEventListener("keydown", handleGlobalKeydown);
  window.clearTimeout(searchTimer);
  window.clearTimeout(toastTimer);
});
</script>

<template>
  <main ref="libraryRoot" class="library-app">
    <aside class="library-sidebar" aria-label="资料库分区">
      <div class="brand library-brand">
        <div class="brand-mark" aria-hidden="true"><span></span><span></span><span></span></div>
        <div><strong>Flank</strong><small>贴在手边</small></div>
      </div>
      <div class="library-kicker">资料库</div>
      <nav class="library-nav">
        <button v-for="section in sections" :key="section.id" class="library-nav-item" :class="{ active: scope === section.id }" type="button" @click="chooseScope(section.id)">
          <span class="section-icon" :class="section.id" aria-hidden="true">
            <svg v-if="section.id === 'active'" viewBox="0 0 24 24"><path d="M5 4h14v16H5zM8 8h8M8 12h8M8 16h5"/></svg>
            <svg v-else-if="section.id === 'archived'" viewBox="0 0 24 24"><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></svg>
            <svg v-else viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg>
          </span>
          <span><b>{{ section.label }}</b><small>{{ section.caption }}</small></span><em>{{ counts[section.id] }}</em>
        </button>
      </nav>
      <div class="library-sidebar-footer">
        <div class="local-badge"><span></span><div><b>仅保存在此设备</b><small>你的内容不会离开本机</small></div></div>
        <button type="button" class="settings-entry" @click="settingsOpen = true">
          <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6A8 8 0 0 0 8 7.1l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10.4 18l.3 2.6h4L15 18a8 8 0 0 0 1.5-1.1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z"/></svg>
          设置
        </button>
      </div>
    </aside>

    <section class="note-index" aria-label="便签列表">
      <header class="index-header">
        <div><p>LIBRARY</p><h1>{{ sections.find(item => item.id === scope)?.label }}</h1></div>
        <button class="new-note-button" type="button" @click="createNote"><span>＋</span>新建便签</button>
      </header>
      <div class="library-search">
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6"/><path d="m16 16 4 4"/></svg>
        <input ref="searchInput" v-model="query" type="search" :placeholder="`搜索${sections.find(item => item.id === scope)?.label}…`" aria-label="搜索标题和正文">
        <kbd>Ctrl F</kbd>
      </div>
      <div class="result-summary">
        <span>{{ query ? `${notes.length} 个搜索结果` : `${notes.length} 个便签` }}</span>
        <div class="view-switch" role="group" aria-label="便签展示方式">
          <button type="button" :class="{ active: viewMode === 'grid' }" title="卡片视图" aria-label="卡片视图" @click="setViewMode('grid')"><svg viewBox="0 0 24 24"><rect x="4" y="4" width="6" height="6"/><rect x="14" y="4" width="6" height="6"/><rect x="4" y="14" width="6" height="6"/><rect x="14" y="14" width="6" height="6"/></svg></button>
          <button type="button" :class="{ active: viewMode === 'list' }" title="列表视图" aria-label="列表视图" @click="setViewMode('list')"><svg viewBox="0 0 24 24"><path d="M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01"/></svg></button>
        </div>
      </div>
      <div v-if="loading" class="library-state"><span class="state-spinner"></span><b>正在读取本地便签</b></div>
      <div v-else-if="error" class="library-state"><b>{{ error }}</b><button type="button" @click="loadNotes()">重试</button></div>
      <div v-else-if="!notes.length" class="library-state empty-state">
        <span class="empty-papers" aria-hidden="true"><i></i><i></i></span>
        <b>{{ query ? '没有匹配的便签' : scope === 'active' ? '还没有展示中的便签' : scope === 'archived' ? '还没有归档便签' : '最近删除是空的' }}</b>
        <p>{{ query ? '试试更短的关键词，搜索会同时检查标题和正文。' : scope === 'active' ? '新建一张便签，让它出现在屏幕边缘。' : '这里的内容会按时间自动整理。' }}</p>
        <button v-if="scope === 'active' && !query" type="button" @click="createNote">新建第一张便签</button>
      </div>
      <div v-else ref="noteList" class="note-list" :class="`mode-${viewMode}`" role="listbox" :aria-label="`${notes.length} 个便签`" @keydown="onListKeydown" @pointerleave="resetCardFocus">
        <button v-for="note in notes" :key="note.id" class="note-row" :class="{ selected: selectedId === note.id }" :style="{ '--note': `var(--note-${note.color})` }" :data-note-id="note.id" type="button" role="option" :aria-selected="selectedId === note.id" @pointerenter="animateCardFocus(note.id)" @focus="animateCardFocus(note.id)" @blur="resetCardFocus" @click="selectNote(note.id, true)">
          <span class="note-color" :style="{ '--note': `var(--note-${note.color})` }"></span>
          <span class="note-fold" :style="{ '--note': `var(--note-${note.color})` }" aria-hidden="true"></span>
          <span class="note-row-copy"><b>{{ note.title || '无标题便签' }}</b><span>{{ note.body.replace(/\s+/g, ' ').slice(0, 120) || '空白便签' }}</span><small><time>{{ formatTime(note.updatedAtMs) }}</time><i v-if="taskProgress(note.body)"></i>{{ taskProgress(note.body) }}<template v-if="scope === 'deleted'"><i></i>{{ retention(note) }}</template></small></span>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 6 6 6-6 6"/></svg>
        </button>
      </div>
    </section>

    <section v-if="editorOpen && (selected || isNew)" class="note-detail" aria-label="便签详情">
      <template v-if="selected || isNew">
        <header class="detail-toolbar">
          <button class="editor-close" type="button" aria-label="关闭便签详情" @click="editorOpen = false">×</button>
          <span class="detail-status"><i :style="{ background: `var(--note-${draft.color})` }"></i>{{ isNew ? '新便签' : scope === 'active' ? '展示中' : scope === 'archived' ? '已归档' : '最近删除' }}</span>
          <div class="detail-actions" v-if="selected">
            <button v-if="scope === 'active'" type="button" title="归档" @click="mutate(selected, 'archive')"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></svg><span>归档</span></button>
            <button v-else-if="scope === 'archived'" type="button" @click="mutate(selected, 'unarchive')"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6M4 4v6h6"/></svg><span>恢复</span></button>
            <button v-else type="button" @click="mutate(selected, 'restore')"><svg viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 3-6M4 4v6h6"/></svg><span>恢复</span></button>
            <button v-if="scope !== 'deleted'" class="danger-action" type="button" @click="mutate(selected, 'delete')"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7"/></svg><span>删除</span></button>
            <button v-else class="danger-action" type="button" @click="deleteTarget = selected"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7"/></svg><span>永久删除</span></button>
          </div>
        </header>
        <div class="editor-wrap" :class="{ readonly: scope === 'deleted' }">
          <input v-model="draft.title" class="note-title-input" type="text" maxlength="200" placeholder="无标题便签" :readonly="scope === 'deleted'" aria-label="便签标题">
          <div class="note-meta"><span>修改于 {{ formatTime(selected?.updatedAtMs ?? Date.now()) }}</span><span v-if="selected">版本 {{ selected.revision }}</span></div>
          <textarea v-model="draft.body" placeholder="写下此刻想到的事…" :readonly="scope === 'deleted'" aria-label="便签正文"></textarea>
        </div>
        <footer class="detail-footer">
          <div class="color-picker" role="group" aria-label="便签颜色">
            <button v-for="color in (['lemon','peach','rose','lilac','sky','mint'] as NoteColor[])" :key="color" :class="{ selected: draft.color === color }" :style="{ background: `var(--note-${color})` }" :disabled="scope === 'deleted'" type="button" :aria-label="`${color} 颜色`" @click="draft.color = color"></button>
          </div>
          <button v-if="scope !== 'deleted'" class="save-note-button" :disabled="!hasChanges || saving" type="button" @click="saveNote">{{ saving ? '保存中…' : hasChanges ? '保存更改' : '已保存' }}</button>
          <span v-else class="retention-detail">{{ retention(selected!) }}</span>
        </footer>
      </template>
    </section>

    <Transition name="modal-fade">
      <div v-if="settingsOpen" class="settings-modal-backdrop" @click.self="settingsOpen = false">
        <SettingsView embedded @close="settingsOpen = false" />
      </div>
    </Transition>

    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null">
      <section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title">
        <span class="dialog-icon">!</span><h2 id="delete-title">永久删除这张便签？</h2><p>“{{ deleteTarget.title || '无标题便签' }}”将立即从此设备移除，此操作无法撤销。</p>
        <div><button type="button" @click="deleteTarget = null">取消</button><button class="confirm-danger" type="button" @click="permanentlyDelete">永久删除</button></div>
      </section>
    </div>
    <Transition name="toast"><div v-if="toast" class="library-toast"><span>✓</span>{{ toast }}</div></Transition>
  </main>
</template>
