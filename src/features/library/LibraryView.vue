<script setup lang="ts">
import { t, formatRelativeTime } from '../../services/i18n';
import { showNotification as showToast } from "../../services/notificationService";
import { computed, nextTick, onMounted, onUnmounted, reactive, ref, watch } from "vue";
import { gsap } from "gsap";
import {
  AlertCircle,
  Archive as ArchiveIcon,
  Pencil,
  Grid2X2,
  List,
  Minus,
  Plus,
  RotateCcw,
  Search,
  Settings,
  Square,
  StickyNote,
  Trash2,
  X,
} from "lucide-vue-next";
import type { NoteRecord, NoteScope } from "../../contracts/note";
import { noteService } from "../../services/noteService";
import { notePaperStyle } from "../../services/noteColorService";
import SettingsView from "../settings/SettingsView.vue";
import NoteEditor from "../../components/NoteEditor.vue";

const scope = ref<NoteScope>("active");
const query = ref("");
const notes = ref<NoteRecord[]>([]);
const selectedId = ref<string | null>(null);
const loading = ref(false);
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
const contextMenu = ref<{ note: NoteRecord; x: number; y: number } | null>(null);
const contextMenuEl = ref<HTMLElement | null>(null);
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
const contextMenuStyle = computed(() => {
  const menu = contextMenu.value;
  if (!menu) return {};
  return { left: `${menu.x}px`, top: `${menu.y}px` };
});
const isNew = ref(false);
const editorKey = ref("new");
const noteEditor = ref<InstanceType<typeof NoteEditor> | null>(null);

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

async function loadNotes(preferredId?: string, options?: { silent?: boolean }) {
  if (!options?.silent) loading.value = true;
  error.value = "";
  try {
    notes.value = await list(scope.value, query.value);
    const wanted = preferredId ?? selectedId.value;
    const nextId = wanted && notes.value.some((note) => note.id === wanted) ? wanted : null;
    selectedId.value = nextId;
    await refreshCounts();
  } catch {
    error.value = t('无法读取本地便签，请稍后重试。');
    notes.value = [];
    selectedId.value = null;
  } finally {
    if (!options?.silent) loading.value = false;
  }
}

async function selectNote(id: string | null, open = false) {
  if (id !== null && editorOpen.value && id !== selectedId.value && !(await closeEditor())) return;
  selectedId.value = id;
  isNew.value = false;
  editorOpen.value = open && id !== null;
  if (open && id !== null) editorKey.value = id;
}

async function chooseScope(next: NoteScope) {
  if (scope.value === next) return;
  if (editorOpen.value && !(await closeEditor())) return;
  closeContextMenu();
  scope.value = next;
  query.value = "";
  void loadNotes();
}

async function createNote() {
  scope.value = "active";
  query.value = "";
  if (editorOpen.value && !(await closeEditor())) return;
  selectedId.value = null;
  isNew.value = true;
  editorOpen.value = true;
  editorKey.value = `new-${Date.now()}`;
  await nextTick();
  noteEditor.value?.focusTitle();
}

async function closeEditor(): Promise<boolean> {
  const result = noteEditor.value ? await noteEditor.value.flush() : "empty";
  if (result === "error") return false;
  editorOpen.value = false;
  if (result === "empty") {
    selectedId.value = null;
    isNew.value = false;
  }
  return true;
}

function onEditorSaved(payload: { note: NoteRecord; isNew: boolean }) {
  if (!isDesktop) {
    if (payload.isNew) demoNotes.value.unshift(payload.note);
    else demoNotes.value = demoNotes.value.map((note) => note.id === payload.note.id ? payload.note : note);
  }
  if (payload.isNew) {
    isNew.value = false;
    selectedId.value = payload.note.id;
    notes.value = [payload.note, ...notes.value.filter((note) => note.id !== payload.note.id)];
    void refreshCounts();
  } else {
    notes.value = notes.value.map((note) => note.id === payload.note.id ? payload.note : note);
  }
}

async function mutateSelected(action: "archive" | "delete") {
  const result = await noteEditor.value?.flush();
  if (result === "error") return;
  const note = selected.value;
  if (!note) return;
  await mutate(note, action);
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
    showToast(action === "archive" ? t('已归档') : action === "unarchive" ? t('已恢复到展示中') : action === "delete" ? t('已移到最近删除') : note.archivedAtMs ? t('已恢复到归档') : t('已恢复到展示中'));
    editorOpen.value = false;
    await loadNotes();
  } catch {
    showToast(t('操作失败，请刷新后重试'));
  }
}

async function permanentlyDelete() {
  const note = deleteTarget.value;
  if (!note) return;
  try {
    if (isDesktop) await noteService.permanentlyDelete({ id: note.id, expectedRevision: note.revision });
    else demoNotes.value = demoNotes.value.filter((item) => item.id !== note.id);
    deleteTarget.value = null;
    showToast(t('便签已永久删除'));
    await loadNotes();
  } catch {
    deleteTarget.value = null;
    showToast(t('永久删除失败，请刷新后重试'));
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
    showToast(t('已清空删除项'));
    await loadNotes();
  } catch {
    clearTrashConfirm.value = false;
    showToast(t('清空失败，请刷新后重试'));
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



const formatTime = formatRelativeTime;

function taskProgress(body: string) {
  const tasks = [...body.matchAll(/^\s*[-*]?\s*\[([ xX])\]/gm)];
  if (!tasks.length) return "";
  const done = tasks.filter((match) => match[1].toLowerCase() === "x").length;
  return `${done}/${tasks.length} 项完成`;
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" })[character]!);
}

function renderInline(value: string) {
  return escapeHtml(value)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/~~([^~]+)~~/g, "<del>$1</del>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+|mailto:[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noreferrer">$1</a>');
}

function cardPreview(body: string) {
  const parts: string[] = [];
  for (const raw of body.split("\n")) {
    const line = raw.trim();
    if (!line) {
      if (parts.length && parts[parts.length - 1] !== "") parts.push("");
      continue;
    }
    const task = line.match(/^\s*(☐|☑)\s?(.*)$/) || line.match(/^\s*-\s*\[([ xX])\]\s?(.*)$/);
    if (task) {
      const checked = task[1] === "☑" || /x/i.test(task[1]);
      parts.push(`<span class="cv-task${checked ? " done" : ""}"><i class="cv-box"></i><span>${renderInline(task[2] ?? "")}</span></span>`);
      continue;
    }
    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      parts.push(`<span class="cv-heading cv-h${heading[1].length}">${renderInline(heading[2])}</span>`);
      continue;
    }
    const list = line.match(/^\s*[-*+]\s+(.*)$/);
    if (list) {
      parts.push(`<span class="cv-list">${renderInline(list[1])}</span>`);
      continue;
    }
    const quote = line.match(/^>\s?(.*)$/);
    if (quote) {
      parts.push(`<span class="cv-quote">${renderInline(quote[1])}</span>`);
      continue;
    }
    parts.push(renderInline(line));
  }
  while (parts.length && parts[parts.length - 1] === "") parts.pop();
  return parts.join("<br>") || `<span class="cv-empty">${t('空白便签')}</span>`;
}

function retention(note: NoteRecord) {
  if (!note.deletedAtMs) return "";
  const days = Math.max(0, Math.ceil((note.deletedAtMs + 30 * 86400000 - Date.now()) / 86400000));
  return days === 0 ? t('即将永久删除') : t('{days} 天后永久删除', { days });
}

function openContextMenu(note: NoteRecord, event: MouseEvent) {
  event.preventDefault();
  contextMenu.value = { note, x: event.clientX, y: event.clientY };
}

function closeContextMenu() {
  contextMenu.value = null;
}

function contextAction(action: "edit" | "archive" | "unarchive" | "restore" | "delete" | "permanentlyDelete") {
  const note = contextMenu.value?.note;
  closeContextMenu();
  if (!note) return;
  if (action === "edit") void selectNote(note.id, true);
  else if (action === "archive") void mutate(note, "archive");
  else if (action === "unarchive") void mutate(note, "unarchive");
  else if (action === "restore") void mutate(note, "restore");
  else if (action === "delete") void mutate(note, "delete");
  else if (action === "permanentlyDelete") deleteTarget.value = note;
}

function handleWindowContextMenu(event: MouseEvent) {
  event.preventDefault();
  const target = event.target instanceof Element ? event.target : null;
  if (target?.closest(".note-card, .record-card")) return;
  closeContextMenu();
}

const closeMenuOnClick = () => closeContextMenu();

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

watch(contextMenu, async (menu) => {
  if (!menu) return;
  await nextTick();
  const el = contextMenuEl.value;
  if (!el) return;
  const width = el.offsetWidth;
  const height = el.offsetHeight;
  menu.x = Math.max(8, Math.min(menu.x, window.innerWidth - width - 8));
  menu.y = Math.max(8, Math.min(menu.y, window.innerHeight - height - 8));
});

function handleGlobalKeydown(event: KeyboardEvent) {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
    event.preventDefault();
    searchInput.value?.focus();
  }
  if (event.key === "Escape") {
    if (contextMenu.value) closeContextMenu();
    else if (deleteTarget.value) deleteTarget.value = null;
    else if (clearTrashConfirm.value) clearTrashConfirm.value = false;
    else if (settingsOpen.value) settingsOpen.value = false;
    else if (editorOpen.value) void closeEditor();
  }
}

onMounted(async () => {
  await loadNotes();
  if (isDesktop) {
    const { listen } = await import("@tauri-apps/api/event");
    unlistenNotesChanged = await listen("notes:changed", () => void loadNotes(undefined, { silent: true }));
  }
  window.addEventListener("keydown", handleGlobalKeydown);
  window.addEventListener("contextmenu", handleWindowContextMenu);
  window.addEventListener("click", closeMenuOnClick);
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
  window.removeEventListener("contextmenu", handleWindowContextMenu);
  window.removeEventListener("click", closeMenuOnClick);
  window.clearTimeout(searchTimer);
});
</script>

<template>
  <main ref="libraryRoot" class="library-app">
    <aside class="library-sidebar" :aria-label="t('资料库分区')">
      <div class="library-brand" data-tauri-drag-region>
        <img src="/noty-logo.png" alt="" />
        <div><strong>FLANK</strong><small>{{ t('灵感停靠站') }}</small></div>
      </div>
      <p class="library-kicker">LIBRARY</p>
      <nav class="library-nav">
        <button v-for="section in sections" :key="section.id" class="library-nav-item" :class="{ active: scope === section.id }" type="button" :aria-current="scope === section.id ? 'page' : undefined" @click="chooseScope(section.id)">
          <span class="section-icon" :class="section.id" aria-hidden="true">
            <StickyNote v-if="section.id === 'active'" />
            <ArchiveIcon v-else-if="section.id === 'archived'" />
            <Trash2 v-else />
          </span>
          <span>{{ section.id === 'active' ? t('全部便签') : t(section.label) }}</span><em>{{ counts[section.id] }}</em>
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
        <span>{{ t('设置') }}</span>
      </button>
    </aside>

    <section class="library-surface">
      <div class="window-drag-region" data-tauri-drag-region></div>
      <div class="window-controls" :aria-label="t('窗口控制')">
        <button type="button" :aria-label="t('最小化')" @click="controlWindow('minimize')"><Minus /></button>
        <button type="button" :aria-label="t('最大化或还原')" @click="controlWindow('maximize')"><Square /></button>
        <button class="window-close" type="button" :aria-label="t('关闭')" @click="controlWindow('close')"><X /></button>
      </div>

      <header class="index-header" :class="{ tall: scope !== 'active' }">
        <div>
          <!-- <p :class="{ danger: scope === 'deleted' }">{{ scope === 'active' ? 'NOTES / 06' : scope === 'archived' ? 'ARCHIVE / 12' : 'TRASH / 03' }}</p> -->
          <h1>{{ scope === 'active' ? t('今天想记点什么？') : scope === 'archived' ? t('已归档') : t('最近删除') }}</h1>
          <span>{{ scope === 'active' ? t('把稍纵即逝的想法，变成随时可取用的便签。') : scope === 'archived' ? t('暂时收起，不代表忘记。需要时随时恢复。') : t('删除的便签会保留 30 天，之后自动永久清除。') }}</span>
        </div>
        <button v-if="scope === 'active'" class="new-note-button" type="button" @click="createNote"><Plus aria-hidden="true" />{{ t('新建便签') }}</button>
        <button v-else-if="scope === 'deleted'" class="clear-trash-button" type="button" @click="clearTrashConfirm = true">{{ t('清空删除项') }}</button>
      </header>

      <div v-if="scope !== 'deleted'" class="home-toolbar" :class="{ 'archive-toolbar': scope === 'archived' }">
        <label class="library-search">
          <Search aria-hidden="true" />
          <input ref="searchInput" v-model="query" type="search" :placeholder="t('搜索标题、正文或标签…')" :aria-label="t('搜索标题、正文或标签')">
          <kbd>⌘ K</kbd>
        </label>
        <template v-if="scope === 'active'">
          <div class="view-switch" role="group" :aria-label="t('便签展示方式')">
            <button type="button" :class="{ active: viewMode === 'grid' }" :aria-label="t('卡片视图')" @click="setViewMode('grid')"><Grid2X2 /></button>
            <button type="button" :class="{ active: viewMode === 'list' }" :aria-label="t('列表视图')" @click="setViewMode('list')"><List /></button>
          </div>
        </template>
        <div v-else class="archive-filter">{{ t('按归档时间 · 最新优先') }}</div>
      </div>
      <div v-else class="trash-alert"><AlertCircle aria-hidden="true" /><div><b>{{ t('最早的一条便签将在 6 天后永久删除') }}</b><small>{{ t('你可以在倒计时结束前恢复它。') }}</small></div></div>

      <div v-if="loading" class="library-state"><span class="state-spinner"></span><b>{{ t('正在读取本地便签') }}</b></div>
      <div v-else-if="error" class="library-state"><b>{{ error }}</b><button type="button" @click="loadNotes()">{{ t('重试') }}</button></div>
      <div v-else-if="!notes.length" class="library-state"><b>{{ query ? t('没有匹配的便签') : t('这里还没有便签') }}</b><p>{{ t('试试新建一张便签，或切换到其他资料库。') }}</p></div>

      <div v-else-if="scope === 'active'" class="notes-scroll">
        <div class="recent-grid" :class="`mode-${viewMode}`">
          <div v-for="note in notes" :key="note.id" class="note-card recent-card" :class="{ selected: selectedId === note.id }" :style="notePaperStyle(note.color)" role="button" tabindex="0" :data-note-id="note.id" :aria-label="t('便签：{title}', { title: note.title || t('无标题便签') })" @click="selectNote(note.id)" @contextmenu.prevent="openContextMenu(note, $event)" @keydown.enter.prevent="selectNote(note.id)" @keydown.space.prevent="selectNote(note.id)">
            <button class="card-edit" type="button" :aria-label="t('编辑便签：{title}', { title: note.title || t('无标题便签') })" :title="t('编辑')" @click.stop="selectNote(note.id, true)"><Pencil aria-hidden="true" /></button>
            <b class="card-title">{{ note.title || t('无标题便签') }}</b>
            <p class="card-preview" v-html="cardPreview(note.body)"></p>
            <small class="card-time">{{ formatTime(note.updatedAtMs) }}</small>
          </div>
        </div>
        <p class="drag-hint">{{ t('拖拽便签即可调整顺序　·　右键查看更多操作') }}</p>
      </div>

      <div v-else class="records-scroll" :class="scope">
        <div class="group-title"><h2>{{ scope === 'archived' ? t('归档记录') : t('待处理') }}</h2><span>{{ notes.length }} ITEMS</span></div>
        <article v-for="note in notes" :key="note.id" class="record-card" :style="notePaperStyle(note.color)" @contextmenu.prevent="openContextMenu(note, $event)">
          <span class="record-color" :class="{ dot: scope === 'deleted' }"></span>
          <div><b>{{ note.title || t('无标题便签') }}</b><p class="card-preview" v-html="cardPreview(note.body)"></p><small v-if="scope === 'archived'">{{ t('归档于') }} {{ formatTime(note.archivedAtMs || note.updatedAtMs) }}　·　{{ noteTag(note) }}</small><small v-else class="days-left">{{ retention(note).toUpperCase() }}</small></div>
          <button type="button" @click="mutate(note, scope === 'archived' ? 'unarchive' : 'restore')">{{ scope === 'archived' ? t('恢复便签') : t('恢复') }}</button>
          <button v-if="scope === 'deleted'" class="delete-forever" type="button" @click="deleteTarget = note">{{ t('永久删除') }}</button>
          <button v-else-if="scope === 'archived'" class="delete-forever" type="button" @click="mutate(note, 'delete')">{{ t('删除') }}</button>
        </article>
      </div>
    </section>

    <section v-if="editorOpen && (selected || isNew)" class="note-detail" :aria-label="t('便签详情')">
      <header class="detail-toolbar">
        <button class="editor-close" type="button" :aria-label="t('关闭便签详情')" @click="closeEditor">×</button>
        <div v-if="selected" class="detail-actions">
          <button type="button" @click="mutateSelected('archive')">{{ t('归档') }}</button>
          <button class="danger-action" type="button" @click="mutateSelected('delete')">{{ t('删除') }}</button>
        </div>
      </header>
      <NoteEditor ref="noteEditor" :key="editorKey" :note="selected" @saved="onEditorSaved" />
    </section>

    <Transition name="modal-fade"><div v-if="settingsOpen" class="settings-modal-backdrop" @click.self="settingsOpen = false"><SettingsView embedded @close="settingsOpen = false" /></div></Transition>
    <div v-if="deleteTarget" class="modal-backdrop" @click.self="deleteTarget = null"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="delete-title"><span class="dialog-icon">!</span><h2 id="delete-title">{{ t('永久删除这张便签？') }}</h2><p>{{ t('“{title}”将立即从此设备移除，此操作无法撤销。', { title: deleteTarget.title || t('无标题便签') }) }}</p><div><button type="button" @click="deleteTarget = null">{{ t('取消') }}</button><button class="confirm-danger" type="button" @click="permanentlyDelete">{{ t('永久删除') }}</button></div></section></div>
    <div v-if="clearTrashConfirm" class="modal-backdrop" @click.self="clearTrashConfirm = false"><section class="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="clear-trash-title"><span class="dialog-icon">!</span><h2 id="clear-trash-title">{{ t('清空所有删除项？') }}</h2><p>{{ t('最近删除中的 {count} 张便签将从此设备永久移除，此操作无法撤销。', { count: notes.length }) }}</p><div><button type="button" :disabled="clearingTrash" @click="clearTrashConfirm = false">{{ t('取消') }}</button><button class="confirm-danger" type="button" :disabled="clearingTrash" @click="clearTrash">{{ clearingTrash ? t('正在清空…') : t('清空删除项') }}</button></div></section></div>

    <Teleport to="body">
      <div v-if="contextMenu" ref="contextMenuEl" class="note-context-menu" :style="contextMenuStyle" role="menu" :aria-label="t('便签操作')">
        <template v-if="scope === 'active'">
          <button type="button" role="menuitem" @click="contextAction('edit')"><Pencil aria-hidden="true" />{{ t('编辑') }}</button>
          <button type="button" role="menuitem" @click="contextAction('archive')"><ArchiveIcon aria-hidden="true" />{{ t('归档') }}</button>
          <button type="button" role="menuitem" class="danger" @click="contextAction('delete')"><Trash2 aria-hidden="true" />{{ t('删除') }}</button>
        </template>
        <template v-else-if="scope === 'archived'">
          <button type="button" role="menuitem" @click="contextAction('unarchive')"><RotateCcw aria-hidden="true" />{{ t('恢复') }}</button>
          <button type="button" role="menuitem" class="danger" @click="contextAction('delete')"><Trash2 aria-hidden="true" />{{ t('删除') }}</button>
        </template>
        <template v-else>
          <button type="button" role="menuitem" @click="contextAction('restore')"><RotateCcw aria-hidden="true" />{{ t('恢复') }}</button>
          <button type="button" role="menuitem" class="danger" @click="contextAction('permanentlyDelete')"><Trash2 aria-hidden="true" />{{ t('永久删除') }}</button>
        </template>
      </div>
    </Teleport>
  </main>
</template>
