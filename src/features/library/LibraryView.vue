<script setup lang="ts">
import { showNotification as showToast } from "../../services/notificationService";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { gsap } from "gsap";
import {
  AlertCircle,
  Archive as ArchiveIcon,
  Ellipsis,
  Grid2X2,
  List,
  Minus,
  Plus,
  Search,
  Settings,
  Square,
  StickyNote,
  Trash2,
  X,
} from "lucide-vue-next";
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

const deleteTarget = ref<NoteRecord | null>(null);
const clearTrashConfirm = ref(false);
const clearingTrash = ref(false);
const editorOpen = ref(false);
const settingsOpen = ref(false);
const viewMode = ref<"grid" | "list">((localStorage.getItem("flank-library-view") as "grid" | "list") || "grid");
const searchInput = ref<HTMLInputElement | null>(null);
const libraryRoot = ref<HTMLElement | null>(null);
const noteList = ref<HTMLElement | null>(null);
let animationContext: gsap.Context | undefined;
let unlistenNotesChanged: (() => void) | undefined;
let searchTimer: number | undefined;


const now = Date.now();
const demoNotes = ref<NoteRecord[]>([
  { id: "demo-1", title: "今日灵感", body: "让工具像家具一样安静，像朋友一样及时。\n\n- [ ] 调整首页留白\n- [x] 完成资料库结构", color: "sky", createdAtMs: now - 86400000 * 2, updatedAtMs: now - 1000 * 60 * 18, archivedAtMs: null, deletedAtMs: null, sortKey: "1", textDirection: "automatic", revision: 1 },
  { id: "demo-2", title: "产品待办", body: "高优先级\n\n- [x] 纵向 Dock 动效\n- [ ] 快速捕获\n- [ ] 导入导出", color: "lemon", createdAtMs: now - 86400000 * 6, updatedAtMs: now - 3600000 * 3, archivedAtMs: null, deletedAtMs: null, sortKey: "2", textDirection: "automatic", revision: 1 },
  { id: "demo-3", title: "阅读清单", body: "《设计中的设计》\n《制造消费者》\n《微交互》", color: "mint", createdAtMs: now - 86400000 * 20, updatedAtMs: now - 86400000 * 3, archivedAtMs: now - 86400000 * 2, deletedAtMs: null, sortKey: "3", textDirection: "automatic", revision: 2 },
  { id: "demo-4", title: "旧会议记录", body: "已经整理进项目文档。", color: "sky", createdAtMs: now - 86400000 * 35, updatedAtMs: now - 86400000 * 5, archivedAtMs: null, deletedAtMs: now - 86400000 * 5, sortKey: "4", textDirection: "automatic", revision: 2 },
  { id: "demo-5", title: "周末采购", body: "燕麦奶、咖啡豆、番茄\n给阳台补一盆薄荷。", color: "mint", createdAtMs: now - 86400000, updatedAtMs: now - 3600000 * 6, archivedAtMs: null, deletedAtMs: null, sortKey: "5", textDirection: "automatic", revision: 1 },
  { id: "demo-6", title: "会议速记", body: "主页以内容为中心；设置收进弹窗；保留卡片与列表两种浏览方式。", color: "mint", createdAtMs: now - 86400000 * 3, updatedAtMs: now - 86400000, archivedAtMs: null, deletedAtMs: null, sortKey: "6", textDirection: "automatic", revision: 1 },
  { id: "demo-7", title: "一句话", body: "好的工具不是吸引注意力，而是在需要时恰好出现。", color: "rose", createdAtMs: now - 86400000 * 4, updatedAtMs: now - 86400000 * 2, archivedAtMs: null, deletedAtMs: null, sortKey: "7", textDirection: "automatic", revision: 1 },
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

function noteTag(note: NoteRecord) {
  const tags = ["PRODUCT", "LIFE", "WORK", "IDEA", "READ", "PERSONAL"];
  return tags[Math.abs(note.id.split("").reduce((sum, char) => sum + char.charCodeAt(0), 0)) % tags.length];
}

async function controlWindow(action: "minimize" | "maximize" | "close") {
  if (!isDesktop) return;
  const { getCurrentWindow } = await import("@tauri-apps/api/window");
  const appWindow = getCurrentWindow();
  if (action === "minimize") await appWindow.minimize();
  else if (action === "maximize") await appWindow.toggleMaximize();
  else await appWindow.close();
}

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

async function clearTrash() {
  if (clearingTrash.value) return;
  clearingTrash.value = true;
  try {
    if (isDesktop) {
      for (const note of notes.value) {
        await noteService.permanentlyDelete({ id: note.id, expectedRevision: note.revision });
      }
    } else {
      const deletedIds = new Set(notes.value.map((note) => note.id));
      demoNotes.value = demoNotes.value.filter((note) => !deletedIds.has(note.id));
    }
    clearTrashConfirm.value = false;
    showToast("已清空删除项");
    await loadNotes();
  } catch {
    clearTrashConfirm.value = false;
    showToast("清空失败，请刷新后重试");
    await loadNotes();
  } finally {
    clearingTrash.value = false;
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
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
  }
  if (event.key === "Escape") {
    if (deleteTarget.value) deleteTarget.value = null;
    else if (clearTrashConfirm.value) clearTrashConfirm.value = false;
    else if (settingsOpen.value) settingsOpen.value = false;
    else if (editorOpen.value) editorOpen.value = false;
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
});
</script>

<template>
  <main ref="libraryRoot" class="library-app">
    <aside class="library-sidebar" aria-label="资料库分区">
      <div class="library-brand" data-tauri-drag-region>
        <img src="/noty-logo.png" alt="" />
        <div><strong>NOTY</strong><small>灵感停靠站</small></div>
      </div>
      <p class="library-kicker">LIBRARY</p>
      <nav class="library-nav">
        <button v-for="section in sections" :key="section.id" class="library-nav-item" :class="{ active: scope === section.id }" type="button" :aria-current="scope === section.id ? 'page' : undefined" @click="chooseScope(section.id)">
          <span class="section-icon" :class="section.id" aria-hidden="true">
            <StickyNote v-if="section.id === 'active'" />
            <ArchiveIcon v-else-if="section.id === 'archived'" />
            <Trash2 v-else />
          </span>
          <span>{{ section.id === 'active' ? '全部便签' : section.label }}</span><em>{{ counts[section.id] }}</em>
        </button>
      </nav>
      <!-- <div class="workspace-block">
        <span class="workspace-label">WORKSPACE</span>
        <div class="workspace-card">
          <span>本周记录</span>
          <div><b>18</b><em>条灵感</em></div>
          <i><span></span></i>
          <small>比上周多 4 条</small>
        </div>
      </div> -->
      <button type="button" class="settings-entry" @click="settingsOpen = true">
        <Settings aria-hidden="true" />
        <span>设置</span>
      </button>
    </aside>

    <section class="library-surface">
      <div class="window-drag-region" data-tauri-drag-region></div>
      <div class="window-controls" aria-label="窗口控制">
        <button type="button" aria-label="最小化" @click="controlWindow('minimize')"><Minus /></button>
        <button type="button" aria-label="最大化或还原" @click="controlWindow('maximize')"><Square /></button>
        <button class="window-close" type="button" aria-label="关闭" @click="controlWindow('close')"><X /></button>
      </div>

      <header class="index-header" :class="{ tall: scope !== 'active' }">
        <div>
          <p :class="{ danger: scope === 'deleted' }">{{ scope === 'active' ? 'NOTES / 06' : scope === 'archived' ? 'ARCHIVE / 12' : 'TRASH / 03' }}</p>
          <h1>{{ scope === 'active' ? '今天想记点什么？' : scope === 'archived' ? '已归档' : '最近删除' }}</h1>
          <span>{{ scope === 'active' ? '把稍纵即逝的想法，变成随时可取用的便签。' : scope === 'archived' ? '暂时收起，不代表忘记。需要时随时恢复。' : '删除的便签会保留 30 天，之后自动永久清除。' }}</span>
        </div>
        <button v-if="scope === 'active'" class="new-note-button" type="button" @click="createNote"><Plus aria-hidden="true" />新建便签</button>
        <button v-else-if="scope === 'deleted'" class="clear-trash-button" type="button" @click="clearTrashConfirm = true">清空删除项</button>
      </header>

      <div v-if="scope !== 'deleted'" class="home-toolbar" :class="{ 'archive-toolbar': scope === 'archived' }">
        <label class="library-search">
          <Search aria-hidden="true" />
          <input ref="searchInput" v-model="query" type="search" placeholder="搜索标题、正文或标签…" aria-label="搜索标题、正文或标签">
          <kbd>⌘ K</kbd>
        </label>
        <template v-if="scope === 'active'">
          <div class="view-switch" role="group" aria-label="便签展示方式">
            <button type="button" :class="{ active: viewMode === 'grid' }" aria-label="卡片视图" @click="setViewMode('grid')"><Grid2X2 /></button>
            <button type="button" :class="{ active: viewMode === 'list' }" aria-label="列表视图" @click="setViewMode('list')"><List /></button>
          </div>
        </template>
        <div v-else class="archive-filter">按归档时间 · 最新优先</div>
      </div>
      <div v-else class="trash-alert"><AlertCircle aria-hidden="true" /><div><b>最早的一条便签将在 6 天后永久删除</b><small>你可以在倒计时结束前恢复它。</small></div></div>

      <div v-if="loading" class="library-state"><span class="state-spinner"></span><b>正在读取本地便签</b></div>
      <div v-else-if="error" class="library-state"><b>{{ error }}</b><button type="button" @click="loadNotes()">重试</button></div>
      <div v-else-if="!notes.length" class="library-state"><b>{{ query ? '没有匹配的便签' : '这里还没有便签' }}</b><p>试试新建一张便签，或切换到其他资料库。</p></div>

      <div v-else-if="scope === 'active'" class="notes-scroll">
        <div class="recent-grid" :class="`mode-${viewMode}`">
          <button v-for="note in notes" :key="note.id" class="note-card recent-card" :style="{ '--note': `var(--note-${note.color})` }" type="button" @click="selectNote(note.id, true)">
            <Ellipsis class="more" aria-hidden="true" />
            <b>{{ note.title || '无标题便签' }}</b><p>{{ note.body.replace(/[-*]\s*\[[ xX]\]\s*/g, '').replace(/\s+/g, ' ').slice(0, 76) || '空白便签' }}</p>
            <small>{{ formatTime(note.updatedAtMs) }}</small>
          </button>
        </div>
        <p class="drag-hint">拖拽便签即可调整顺序　·　右键查看更多操作</p>
      </div>

      <div v-else class="records-scroll" :class="scope">
        <div class="group-title"><h2>{{ scope === 'archived' ? '归档记录' : '待处理' }}</h2><span>{{ notes.length }} ITEMS</span></div>
        <article v-for="note in notes" :key="note.id" class="record-card" :style="{ '--note': `var(--note-${note.color})` }">
          <span class="record-color" :class="{ dot: scope === 'deleted' }"></span>
          <div><b>{{ note.title || '无标题便签' }}</b><p>{{ note.body.replace(/\s+/g, ' ').slice(0, 105) || '空白便签' }}</p><small v-if="scope === 'archived'">归档于 {{ formatTime(note.archivedAtMs || note.updatedAtMs) }}　·　{{ noteTag(note) }}</small><small v-else class="days-left">{{ retention(note).toUpperCase() }}</small></div>
          <button type="button" @click="mutate(note, scope === 'archived' ? 'unarchive' : 'restore')">{{ scope === 'archived' ? '恢复便签' : '恢复' }}</button>
          <button v-if="scope === 'deleted'" class="delete-forever" type="button" @click="deleteTarget = note">永久删除</button>
        </article>
      </div>
    </section>

    <section v-if="editorOpen && (selected || isNew)" class="note-detail" aria-label="便签详情">
      <header class="detail-toolbar">
        <button class="editor-close" type="button" aria-label="关闭便签详情" @click="editorOpen = false">×</button>
        <span class="detail-status"><i :style="{ background: `var(--note-${draft.color})` }"></i>{{ isNew ? '新便签' : '便签详情' }}</span>
        <div v-if="selected" class="detail-actions">
          <button v-if="scope === 'active'" type="button" @click="mutate(selected, 'archive')">归档</button>
          <button v-else type="button" @click="mutate(selected, scope === 'archived' ? 'unarchive' : 'restore')">恢复</button>
          <button v-if="scope !== 'deleted'" class="danger-action" type="button" @click="mutate(selected, 'delete')">删除</button>
        </div>
      </header>
      <div class="editor-wrap" :class="{ readonly: scope === 'deleted' }">
        <input v-model="draft.title" class="note-title-input" type="text" maxlength="200" placeholder="无标题便签" :readonly="scope === 'deleted'" aria-label="便签标题">
        <div class="note-meta">修改于 {{ formatTime(selected?.updatedAtMs ?? Date.now()) }}</div>
        <textarea v-model="draft.body" placeholder="写下此刻想到的事…" :readonly="scope === 'deleted'" aria-label="便签正文"></textarea>
      </div>
      <footer class="detail-footer">
        <div class="color-picker" role="group" aria-label="便签颜色"><button v-for="color in (['lemon','peach','rose','lilac','sky','mint'] as NoteColor[])" :key="color" :class="{ selected: draft.color === color }" :style="{ background: `var(--note-${color})` }" :disabled="scope === 'deleted'" type="button" :aria-label="`${color} 颜色`" @click="draft.color = color"></button></div>
        <button v-if="scope !== 'deleted'" class="save-note-button" :disabled="!hasChanges || saving" type="button" @click="saveNote">{{ saving ? '保存中…' : hasChanges ? '保存更改' : '已保存' }}</button>
      </footer>
    </section>

    <Transition name="modal-fade"><div v-if="settingsOpen" class="settings-modal-backdrop" @click.self="settingsOpen = false"><SettingsView embedded @close="settingsOpen = false" /></div></Transition>
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><span class="dialog-icon">!</span><h2 id="delete-title">永久删除这张便签？</h2><p>“{{ deleteTarget.title || '无标题便签' }}”将立即从此设备移除，此操作无法撤销。</p><div><button type="button" @click="deleteTarget = null">取消</button><button class="confirm-danger" type="button" @click="permanentlyDelete">永久删除</button></div></section></div>
    <div v-if="clearTrashConfirm" class="modal-backdrop" @click.self="clearTrashConfirm = false"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-trash-title"><span class="dialog-icon">!</span><h2 id="clear-trash-title">清空所有删除项？</h2><p>最近删除中的 {{ notes.length }} 张便签将从此设备永久移除，此操作无法撤销。</p><div><button type="button" :disabled="clearingTrash" @click="clearTrashConfirm = false">取消</button><button class="confirm-danger" type="button" :disabled="clearingTrash" @click="clearTrash">{{ clearingTrash ? '正在清空…' : '清空删除项' }}</button></div></section></div>

  </main>
</template>
