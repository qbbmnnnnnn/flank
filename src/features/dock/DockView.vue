<script setup lang="ts">
import { t } from '../../services/i18n';
import { guideCopy } from './guide';
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { gsap } from "gsap";
import type Sortable from "sortablejs";
import { showNotification as showToast, showNotification as showLocalToast } from "../../services/notificationService";
import { dockLayout, type DockSize } from "./layout";

import type { AppSettings } from "../../contracts/app";
import { appService } from "../../services/appService";
import { noteService } from "../../services/noteService";
import {
  DOCK_BRIDGE,
  emitToPanel,
  isTauriRuntime,
  listenOnWebview,
  type DockPanelSavePayload,
  type Note,
} from "./bridge";
import { notePaperStyle } from "../../services/noteColorService";
import { createNoteSortable, moveItem } from "../notes/sortable";

const root = ref<HTMLElement | null>(null);
const noteList = ref<HTMLElement | null>(null);
const side = ref<"left" | "right">("right");
const screenHeight = ref(1080);
const previewNow = Date.now();
const previewNotes: Note[] = [
  ["idea", "今日灵感", "lemon", "让工具像家具一样安静，像朋友一样及时。\n\n☐ 调整首页留白\n☐ 试试侧边吸附\n☑ 完成窗口原型"],
  ["todo", "产品待办", "peach", "## 高优先级\n\n- 纵向 Dock 动效\n- 便签快速唤起\n- 本地自动保存"],
  ["reading", "阅读清单", "mint", "这个月想读：\n\n《设计中的设计》\n《毫无意义的工作》\n《制造消费者》"],
].map(([id, title, color, body], index) => ({
  id, title, color: color as Note["color"], body,
  createdAtMs: previewNow - index * 86400000,
  updatedAtMs: previewNow - index * 3600000,
  archivedAtMs: null, deletedAtMs: null,
  sortKey: String(index), textDirection: "automatic", revision: 1,
}));
const notes = ref<Note[]>(isTauriRuntime() ? [] : previewNotes);
const GUIDE_NOTE_ID = "__flank_dock_guide__";
const guideNote = computed<Note>(() => ({
  id: GUIDE_NOTE_ID,
  ...guideCopy(),
  color: "lemon",
  createdAtMs: 0,
  updatedAtMs: 0,
  archivedAtMs: null,
  deletedAtMs: null,
  sortKey: "",
  textDirection: "automatic",
  revision: 0,
}));
const displayNotes = computed(() => notes.value.length > 0 ? notes.value : [guideNote.value]);

const controlsVisible = ref(false);
const actionNote = ref<string | null>(null);
const peekNote = ref<string | null>(null);
const settingsSelected = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const sorting = ref(false);


// Panel coordination state (the rail is the only controller of the panel window).
const panelOpen = ref(false);
const activeNoteId = ref<string | null>(null);
const isNewNotePending = ref(false);

let context: gsap.Context | undefined;
let media: gsap.MatchMedia | undefined;

let settingsSelectedTimer: number | undefined;
let controlsHideTimer: number | undefined;
let controlsTimeline: gsap.core.Timeline | undefined;
let noteListObserver: ResizeObserver | undefined;
let pendingCloseTimer: number | undefined;
let unlistenPanelSave: (() => void) | undefined;
let unlistenPanelBlurred: (() => void) | undefined;
let unlistenPanelRequestClose: (() => void) | undefined;
let unlistenCreateNote: (() => void) | undefined;
let unlistenDockHidden: (() => void) | undefined;
let panelToken = 0;
let suppressBlurUntil = 0;
const hoverTimers = new Map<string, number>();
const quickSetters = new Map<HTMLElement, { x: (value: number) => void; scaleX: (value: number) => void; scaleY: (value: number) => void }>();

const compact = computed(() => screenHeight.value <= 800);
const visibleCount = ref(5);
const dockSize = ref<DockSize>("medium");
const layout = computed(() => dockLayout(displayNotes.value.length, visibleCount.value, screenHeight.value, dockSize.value));
const listTargetHeight = computed(() => layout.value.listHeight);
const peekScale = computed(() => layout.value.scale);
let layoutQueue = Promise.resolve();
let unlistenScale: (() => void) | undefined;
let unlistenSettings: (() => void) | undefined;
let unlistenNotesChanged: (() => void) | undefined;
let noteSortable: Sortable | undefined;
let dragEndedAt = 0;

async function loadDockNotes() {
  if (!isTauriRuntime()) return;
  try {
    notes.value = await noteService.list({ scope: "active", query: "" });
    if (notes.value.length > 0 && activeNoteId.value === GUIDE_NOTE_ID) await closePanel();
    await nextTick();
    setupQuickSetters();
    setupNoteSortable();
    updateScrollEdges();
    // An empty transparent rail has no visible target that can trigger the
    // hover animation. Keep its creation controls exposed until a note exists.
    if (notes.value.length === 0) showControls();
  } catch {
    showLocalToast(t('无法读取本地便签'), "error");
  }
}

async function applyDockSettings(settings: AppSettings) {
  visibleCount.value = settings.dockVisibleCount;
  side.value = settings.dockSide;
  dockSize.value = settings.dockSize;
  await resizeDock();
}

function resizeDock() {
  layoutQueue = layoutQueue.then(async () => {
    if (!isTauriRuntime()) return;
    const win = await getDockWindow();
    if (!win) return;
    await updateDisplayMetrics();
    const { LogicalSize } = await import("@tauri-apps/api/dpi");
    await win.setSize(new LogicalSize(layout.value.railWidth, layout.value.windowHeight));
    await snapNativeWindow();
    await emitToPanel(DOCK_BRIDGE.railResize, { railWidth: layout.value.railWidth });
  }).catch((error) => console.error("Unable to size Dock", error));
  return layoutQueue;
}

function displayTitle(title: string) {
  const chars = Array.from(title);
  return chars.length > 5 ? `${chars.slice(0, 5).join("")}…` : title;
}

function isReducedMotion() {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function inward() {
  return side.value === "left" ? 1 : -1;
}

function setupQuickSetters() {
  quickSetters.clear();
  root.value?.querySelectorAll<HTMLElement>(".note-tab").forEach((item) => {
    quickSetters.set(item, {
      x: gsap.quickTo(item, "x", { duration: isReducedMotion() ? 0 : .34, ease: "power3.out" }),
      scaleX: gsap.quickTo(item, "scaleX", { duration: isReducedMotion() ? 0 : .34, ease: "power3.out" }),
      scaleY: gsap.quickTo(item, "scaleY", { duration: isReducedMotion() ? 0 : .34, ease: "power3.out" }),
    });
  });
}

async function getDockWindow() {
  try {
    const { getCurrentWindow } = await import("@tauri-apps/api/window");
    return getCurrentWindow();
  } catch {
    return null;
  }
}

async function updateDisplayMetrics(monitor?: { size: { height: number }; scaleFactor: number } | null) {
  try {
    const resolved = monitor ?? await (await import("@tauri-apps/api/window")).currentMonitor();
    if (resolved) screenHeight.value = resolved.size.height / resolved.scaleFactor;
  } catch {
    screenHeight.value = window.screen?.height || 1080;
  }
}

// ---------------------------------------------------------------------------
// Panel window control (native show/hide + cross-webview events)
// ---------------------------------------------------------------------------

async function invokeTauri<T>(command: string, args?: Record<string, unknown>): Promise<T | null> {
  if (!("__TAURI_INTERNALS__" in window)) return null;
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    return await invoke<T>(command, args);
  } catch {
    return null;
  }
}

async function showDockPanel(anchorSide: "left" | "right") {
  if (!("__TAURI_INTERNALS__" in window)) {
    showLocalToast(t('便签面板需在桌面应用中查看'), "info");
    return;
  }
  await invokeTauri("show_dock_panel", { anchorSide });
}

function hideDockPanel() {
  void invokeTauri("hide_dock_panel");
}

async function openNote(note: Note) {
  const isPlaceholder = note.id === GUIDE_NOTE_ID;
  if (panelOpen.value && activeNoteId.value === note.id) {
    // Persisted notes toggle preview/edit; the Dock-only guide stays read-only.
    suppressBlurUntil = Date.now() + 260;
    window.clearTimeout(pendingCloseTimer);
    await showDockPanel(side.value);
    await emitToPanel(DOCK_BRIDGE.open, { note, anchorSide: side.value, isNew: false, sameNote: true, isPlaceholder, dockRailWidth: layout.value.railWidth });
    return;
  }

  panelOpen.value = true;
  activeNoteId.value = note.id;
  isNewNotePending.value = false;
  suppressBlurUntil = Date.now() + 260;
  window.clearTimeout(pendingCloseTimer);
  panelToken += 1;
  await showDockPanel(side.value);
  await emitToPanel(DOCK_BRIDGE.open, { note, anchorSide: side.value, isNew: false, sameNote: false, isPlaceholder, dockRailWidth: layout.value.railWidth });
}

async function createNote() {
  if (isNewNotePending.value) {
    await closePanel();
    return;
  }

  panelOpen.value = true;
  activeNoteId.value = null;
  isNewNotePending.value = true;
  suppressBlurUntil = Date.now() + 260;
  window.clearTimeout(pendingCloseTimer);
  panelToken += 1;
  await showDockPanel(side.value);
  await emitToPanel(DOCK_BRIDGE.open, { note: null, anchorSide: side.value, isNew: true, sameNote: false, isPlaceholder: false, dockRailWidth: layout.value.railWidth });
}

async function closePanel() {
  if (!panelOpen.value) return;
  window.clearTimeout(pendingCloseTimer);
  suppressBlurUntil = Date.now() + 260;
  panelOpen.value = false;
  activeNoteId.value = null;
  isNewNotePending.value = false;
  resetRail();
  panelToken += 1;
  const token = panelToken;
  await emitToPanel(DOCK_BRIDGE.close, null);
  // Give the panel's exit animation time to run before hiding the native window.
  window.setTimeout(() => {
    if (panelToken === token) hideDockPanel();
  }, 240);
}

function onPanelSave(payload: DockPanelSavePayload) {
  const index = notes.value.findIndex((item) => item.id === payload.note.id);
  if (index === -1) notes.value.unshift(payload.note);
  else notes.value[index] = payload.note;
  if (payload.isNew) isNewNotePending.value = false;
  if (panelOpen.value) activeNoteId.value = payload.note.id;
  nextTick(() => {
    setupQuickSetters();
    setupNoteSortable();
    updateScrollEdges();
  });
}

function onPanelBlurred() {
  if (Date.now() < suppressBlurUntil) return;
  if (!panelOpen.value) return;
  window.clearTimeout(pendingCloseTimer);
  pendingCloseTimer = window.setTimeout(() => void closePanel(), 180);
}

function onPanelRequestClose() {
  void closePanel();
}

// ---------------------------------------------------------------------------
// Rail interaction
// ---------------------------------------------------------------------------

function updateScrollEdges() {
  const list = noteList.value;
  if (!list) return;
  const maxScroll = Math.max(0, list.scrollHeight - list.clientHeight);
  canScrollUp.value = list.scrollTop > 2;
  canScrollDown.value = maxScroll - list.scrollTop > 2;
}

function findTab(id: string) {
  return root.value?.querySelector<HTMLElement>(`.note-tab[data-id="${id}"]`) ?? null;
}

function onRailMove(event: PointerEvent) {
  if (sorting.value) return;
  showControls();
  const direction = inward();
  const peek = peekScale.value;
  const hovered = (event.target as HTMLElement).closest<HTMLElement>(".note-tab");
  const tabs = [...(root.value?.querySelectorAll<HTMLElement>(".note-tab") ?? [])];
  let nearest: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
    const influence = gsap.utils.clamp(0, 1, 1 - distance / (132 * peek));
    const scale = 1 + influence * .14;
    let x = gsap.utils.mapRange(0, 1, 0, 24 * peek * direction, influence);
    if (tab.dataset.id === activeNoteId.value) x += 20 * peek * direction;
    if (tab === hovered && tab.dataset.id) {
      x = gsap.utils.mapRange(0, 1, 0, 4 * peek * direction, influence);
      x += (actionNote.value === tab.dataset.id ? 42 : 20) * peek * direction;
    }
    quickSetters.get(tab)?.scaleX(scale);
    quickSetters.get(tab)?.scaleY(scale);
    quickSetters.get(tab)?.x(x);
    if (distance < nearestDistance) {
      nearest = tab;
      nearestDistance = distance;
    }
  }
  tabs.forEach((tab) => tab.classList.toggle("nearest", tab === nearest && nearestDistance < 58 * peek));
}

function resetRail() {
  actionNote.value = null;
  peekNote.value = null;
  root.value?.querySelectorAll<HTMLElement>(".note-tab").forEach((tab) => {
    quickSetters.get(tab)?.scaleX(1);
    quickSetters.get(tab)?.scaleY(1);
    quickSetters.get(tab)?.x(tab.dataset.id === activeNoteId.value ? 20 * peekScale.value * inward() : 0);
    tab.classList.remove("nearest");
  });
}

function beginHover(note: Note) {
  window.clearTimeout(hoverTimers.get(note.id));
  peekNote.value = note.id;
  const tab = findTab(note.id);
  if (tab) quickSetters.get(tab)?.x(20 * peekScale.value * inward());
  if (note.id === GUIDE_NOTE_ID) return;
  const timer = window.setTimeout(() => {
    if (peekNote.value !== note.id) return;
    actionNote.value = note.id;
    const current = findTab(note.id);
    if (current) quickSetters.get(current)?.x(42 * peekScale.value * inward());
  }, 1000);
  hoverTimers.set(note.id, timer);
}

function endHover(note: Note) {
  window.clearTimeout(hoverTimers.get(note.id));
  if (peekNote.value === note.id) peekNote.value = null;
  if (actionNote.value === note.id) actionNote.value = null;
  const tab = findTab(note.id);
  if (tab) quickSetters.get(tab)?.x(note.id === activeNoteId.value ? 20 * peekScale.value * inward() : 0);
}

function controlElements() {
  const scope = root.value;
  return {
    controls: scope?.querySelector<HTMLElement>(".rail-controls") ?? null,
    actions: [...(scope?.querySelectorAll<HTMLElement>(".rail-controls > button") ?? [])],
  };
}

function buildControlsTimeline() {
  const { controls, actions } = controlElements();
  controlsTimeline?.kill();
  gsap.killTweensOf([controls, ...actions]);
  const duration = isReducedMotion() ? 0 : .42;
  controlsTimeline = gsap.timeline({ paused: true, defaults: { overwrite: "auto" } })
    .fromTo(controls, { autoAlpha: 0, x: 18 * -inward() }, { autoAlpha: 1, x: 0, duration: duration * .55, ease: "power2.out" }, 0)
    .fromTo(actions, { autoAlpha: 0, y: -30, scale: .76 }, { autoAlpha: 1, y: 0, scale: 1, duration, stagger: isReducedMotion() ? 0 : .12, ease: "back.out(1.9)" }, isReducedMotion() ? 0 : .08);
}

function showControls() {
  window.clearTimeout(controlsHideTimer);
  if (controlsVisible.value) return;
  controlsVisible.value = true;
  nextTick(() => {
    if (!controlsTimeline) buildControlsTimeline();
    controlsTimeline?.play();
  });
}

function hideControls(force = false) {
  window.clearTimeout(controlsHideTimer);
  if (!force && notes.value.length === 0) return;
  controlsVisible.value = false;
  if (force || isReducedMotion()) {
    controlsTimeline?.kill();
    controlsTimeline = undefined;
    const { controls, actions } = controlElements();
    gsap.set([controls, ...actions], { autoAlpha: 0 });
    return;
  }
  controlsTimeline?.reverse();
}

function onRailLeave() {
  resetRail();
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => hideControls(), 1200);
}

// ---------------------------------------------------------------------------
// Note ordering and actions
// ---------------------------------------------------------------------------

function setupNoteSortable() {
  noteSortable?.destroy();
  noteSortable = undefined;
  const list = noteList.value;
  if (!list || notes.value.length < 2) return;
  noteSortable = createNoteSortable(list, {
    draggable: ".note-tab:not(.guide)",
    // Quick-action buttons share the paper's right half. Let a short click
    // reach them, but let Sortable claim a delayed move from the same pixels.
    filter: "a,input,textarea,select,[contenteditable='true']",
    onStart() {
      sorting.value = true;
      actionNote.value = null;
      peekNote.value = null;
      hoverTimers.forEach((timer) => window.clearTimeout(timer));
      const tabs = list.querySelectorAll<HTMLElement>(".note-tab");
      gsap.killTweensOf(tabs);
      gsap.set(tabs, { clearProps: "transform" });
      quickSetters.clear();
    },
    onEnd: (oldIndex, newIndex) => void reorderDockNotes(oldIndex, newIndex),
    onCancel() {
      sorting.value = false;
      setupQuickSetters();
    },
  });
}

async function reorderDockNotes(oldIndex: number, newIndex: number) {
  const previous = notes.value;
  const reordered = moveItem(previous, oldIndex, newIndex);
  dragEndedAt = Date.now();
  sorting.value = false;
  if (reordered === previous) {
    setupQuickSetters();
    return;
  }
  notes.value = reordered;
  await nextTick();
  setupQuickSetters();
  updateScrollEdges();
  if (!isTauriRuntime()) return;
  try {
    await noteService.reorder({ noteIds: reordered.map((note) => note.id) });
  } catch {
    notes.value = previous;
    showToast(t('排序保存失败，已恢复原顺序'), "error");
    await loadDockNotes();
  }
}

function onTabClick(note: Note, event: MouseEvent) {
  if (sorting.value || Date.now() - dragEndedAt < 160) {
    event.preventDefault();
    event.stopPropagation();
    return;
  }
  void openNote(note);
}

async function archiveNote(note: Note) {
  try {
    if (isTauriRuntime()) await noteService.archive({ id: note.id, expectedRevision: note.revision });
    notes.value = notes.value.filter((item) => item.id !== note.id);
    quickSetters.delete(findTab(note.id) as HTMLElement);
    if (activeNoteId.value === note.id) await closePanel();
    showToast(t('“{title}”已归档', { title: note.title }), "success");
    } catch {
      showToast(t('归档失败，便签可能已在其他窗口修改'), "error");
    await loadDockNotes();
  }
}

async function deleteNote(note: Note) {
  try {
    if (isTauriRuntime()) await noteService.delete({ id: note.id, expectedRevision: note.revision });
    notes.value = notes.value.filter((item) => item.id !== note.id);
    quickSetters.delete(findTab(note.id) as HTMLElement);
    if (activeNoteId.value === note.id) await closePanel();
    showToast(t('“{title}”已移到废纸篓', { title: note.title }), "success");
    } catch {
      showToast(t('删除失败，便签可能已在其他窗口修改'), "error");
    await loadDockNotes();
  }
}

// ---------------------------------------------------------------------------
// Screen-edge centering
// ---------------------------------------------------------------------------

async function snapNativeWindow() {
  const win = await getDockWindow();
  if (!win) return;
  try {
    const [{ monitorFromPoint }, { PhysicalPosition }, position, size, scaleFactor] = await Promise.all([
      import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"), win.outerPosition(), win.outerSize(), win.scaleFactor(),
    ]);
    const railWidth = size.width;
    const centerX = position.x + (side.value === "right" ? size.width - railWidth / 2 : railWidth / 2);
    const centerY = position.y + size.height / 2;
    const monitor = await monitorFromPoint(centerX, centerY);
    if (!monitor) return;
    await updateDisplayMetrics(monitor);
    const target = {
      x: side.value === "left" ? monitor.position.x : monitor.position.x + monitor.size.width - size.width,
      y: Math.round(monitor.position.y + (monitor.size.height - size.height) / 2),
    };
    await win.setPosition(new PhysicalPosition(target.x, target.y));
  } catch {
    // Keep the current position if a window manager rejects repositioning.
  }
}

async function openSettings() {
  window.clearTimeout(settingsSelectedTimer);
  settingsSelected.value = true;
  settingsSelectedTimer = window.setTimeout(() => (settingsSelected.value = false), 650);
  try {
    await appService.showMainWindow();
  } catch {
    showToast(t('无法打开主窗口，请重试'), "error");
  }
}

function onRootKeydown(event: KeyboardEvent) {
  if (event.key === "Escape") void closePanel();
}

function onRootPointerDown(event: PointerEvent) {
  if (!panelOpen.value) return;
  const target = event.target as HTMLElement;
  if (target.closest(".note-tab") || target.closest('[data-control="add"]')) return;
  void closePanel();
}

watch([listTargetHeight, side, screenHeight, dockSize], () => void resizeDock());

watch(() => notes.value.length, (count) => {
  void nextTick(() => {
    updateScrollEdges();
    if (count === 0) showControls();
  });
});

onMounted(async () => {
  document.documentElement.classList.add("dock-document");
  document.body.classList.add("dock-document");
  await updateDisplayMetrics();
  await loadDockNotes();
  try {
    await applyDockSettings(await appService.getSettings());
    const win = await getDockWindow();
    unlistenScale = await win?.onScaleChanged(() => void resizeDock());
    const { listen } = await import("@tauri-apps/api/event");
    unlistenSettings = await listen<AppSettings>("settings-updated", (event) => void applyDockSettings(event.payload));
    unlistenNotesChanged = await listen("notes:changed", () => void loadDockNotes());
  } catch {
    // Browser preview uses local defaults.
  }
  setupQuickSetters();
  setupNoteSortable();
  updateScrollEdges();
  if (noteList.value) {
    noteListObserver = new ResizeObserver(updateScrollEdges);
    noteListObserver.observe(noteList.value);
  }
  if (root.value) {
    context = gsap.context(() => {
      media = gsap.matchMedia();
      media.add("(prefers-reduced-motion: no-preference)", () => {
        gsap.from(".dock-rail", { x: 80, autoAlpha: 0, duration: .8, delay: .18, ease: "back.out(1.2)" });
        gsap.from(".note-tab", { x: 24, autoAlpha: 0, duration: .45, stagger: .045, delay: .38, ease: "power3.out" });
      });
    }, root.value);
  }

  unlistenPanelSave = await listenOnWebview<DockPanelSavePayload>(DOCK_BRIDGE.save, onPanelSave);
  unlistenPanelBlurred = await listenOnWebview<null>(DOCK_BRIDGE.blurred, onPanelBlurred);
  unlistenPanelRequestClose = await listenOnWebview<null>(DOCK_BRIDGE.requestClose, onPanelRequestClose);
  unlistenCreateNote = await listenOnWebview<null>(DOCK_BRIDGE.createNote, () => void createNote());
  unlistenDockHidden = await listenOnWebview<null>(DOCK_BRIDGE.hidden, () => void closePanel());

});

onUnmounted(() => {
  document.documentElement.classList.remove("dock-document");
  document.body.classList.remove("dock-document");
  window.clearTimeout(settingsSelectedTimer);
  window.clearTimeout(controlsHideTimer);
  window.clearTimeout(pendingCloseTimer);
  hoverTimers.forEach((timer) => window.clearTimeout(timer));
  noteListObserver?.disconnect();
  unlistenPanelSave?.();
  unlistenPanelBlurred?.();
  unlistenPanelRequestClose?.();
  unlistenCreateNote?.();
  unlistenDockHidden?.();
  unlistenSettings?.();
  unlistenScale?.();
  unlistenNotesChanged?.();
  controlsTimeline?.kill();
  noteSortable?.destroy();
  if (root.value) gsap.killTweensOf(root.value.querySelectorAll("*"));
  media?.revert();
  context?.revert();
});
</script>

<template>
  <main ref="root" class="dock-window" :class="[`dock-${side}`, { 'screen-compact': compact }]" :style="{ '--screen-height': `${screenHeight}px`, '--list-target': `${listTargetHeight}px`, '--note-gap': `${layout.gap}px`, '--note-margin-top': `${layout.marginTop}px`, '--note-height': `${layout.noteHeight}px`, '--title-size': `${layout.titleSize}px`, '--rail': `${layout.railWidth}px`, '--tab-width': `${layout.tabWidth}px`, '--tab-margin': `${layout.tabMargin}px`, '--spine': `${layout.spineOffset}px`, '--title-width': `${layout.titleWidth}px`, '--action-btn': `${layout.actionBtn}px`, '--action-icon': `${layout.actionIcon}px`, '--action-gap': `${layout.actionGap}px`, '--action-edge': `${layout.actionEdge}px`, '--action-spine': `${layout.actionSpine}px` }" @keydown="onRootKeydown" @pointerdown="onRootPointerDown">
    <aside class="dock-rail" :class="{ 'controls-visible': controlsVisible }" :aria-label="t('便签栏')" @pointermove="onRailMove" @pointerleave="onRailLeave">
      <div class="note-list-shell" :class="{ 'overflow-top': canScrollUp, 'overflow-bottom': canScrollDown }">
        <div ref="noteList" class="note-list" :class="{ sorting }" @scroll="updateScrollEdges" @pointerenter="showControls">
        <div v-for="note in displayNotes" :key="note.id" class="note-tab" :class="{ active: activeNoteId === note.id, actions: actionNote === note.id, guide: note.id === GUIDE_NOTE_ID }" :data-id="note.id" role="button" tabindex="0" draggable="false" :aria-label="t('打开{title}', { title: note.title })" :aria-roledescription="note.id === GUIDE_NOTE_ID ? undefined : t('可排序便签')" @pointerenter="beginHover(note)" @pointerleave="endHover(note)" @click="onTabClick(note, $event)" @keydown.enter.prevent="openNote(note)" @keydown.space.prevent="openNote(note)">
          <span class="paper" :style="notePaperStyle(note.color)"><span class="title">{{ displayTitle(note.title) }}</span><span v-if="note.id !== GUIDE_NOTE_ID" class="quick-actions"><button type="button" :title="t('归档')" :aria-label="t('归档')" @click.stop="archiveNote(note)"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></svg></button><button type="button" :title="t('删除')" :aria-label="t('删除')" @click.stop="deleteNote(note)"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></span></span>
        </div>
        </div>
      </div>
      <div class="rail-controls"><span class="separator"></span>
        <button class="adaptive-control" :class="{ selected: isNewNotePending }" data-control="add" type="button" :aria-label="t('新建便签')" :aria-pressed="isNewNotePending ? 'true' : 'false'" @click="createNote"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="adaptive-control" :class="{ selected: settingsSelected }" data-control="settings" type="button" :aria-label="t('打开设置')" @click="openSettings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.38.73.6 1 .28.34.67.54 1.1.6H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg></button>
      </div>
    </aside>


  </main>
</template>

<style scoped>
.dock-window{--rail:104px;--tab-width:88px;--tab-margin:-48px;--spine:42px;--title-width:36px;--note-height:126px;--title-size:16px;--action-btn:26px;--action-icon:14px;--action-gap:7px;--action-edge:6px;--action-spine:7px;--ease:cubic-bezier(.22,1,.36,1);width:100vw;height:100vh;position:relative;overflow:hidden;color:#29262b;background:transparent;pointer-events:none;user-select:none;-webkit-user-select:none;font-family:var(--note-font,"Noty Display","Microsoft YaHei",Geist,"Segoe UI",sans-serif)}.dock-window svg,.note-tab,.paper{-webkit-user-drag:none}.note-tab,.rail-controls>button{pointer-events:auto}.dock-rail{position:absolute;z-index:5;top:50%;right:0;width:var(--rail);height:calc(var(--list-target) + 114px);padding:3px 0;display:flex;flex-direction:column;align-items:flex-end;transform:translateY(-50%);perspective:700px;pointer-events:none}.dock-left .dock-rail{left:0;right:auto;align-items:flex-start}
.note-list-shell{position:relative;width:100%;min-height:0;height:var(--list-target);flex:0 0 var(--list-target);overflow:hidden;pointer-events:none}.note-list{width:100%;height:100%;max-height:none;padding:14px 0;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:var(--note-gap);overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scroll-behavior:smooth;scrollbar-width:none}.note-list::-webkit-scrollbar{display:none}.dock-left .note-list{align-items:flex-start}.note-tab{position:relative;width:var(--tab-width);height:var(--note-height);flex:0 0 var(--note-height);margin:0 var(--tab-margin) 0 0;padding:0;border:0;color:#302c2e;background:transparent;cursor:pointer;transform-origin:right center;will-change:transform;rotate:var(--tilt,0deg)}.note-tab+.note-tab{margin-top:var(--note-margin-top)}.dock-left .note-tab{margin-right:0;margin-left:var(--tab-margin);transform-origin:left center}.note-tab:nth-child(1){--tilt:-1.8deg;z-index:1}.note-tab:nth-child(2){--tilt:.9deg;z-index:2}.note-tab:nth-child(3){--tilt:-1.1deg;z-index:3}.note-tab:nth-child(4){--tilt:1.25deg;z-index:4}.note-tab:nth-child(5){--tilt:-1.35deg;z-index:5}.note-tab:nth-child(n+6){--tilt:-1deg}.note-tab.nearest,.note-tab.active,.note-tab:hover,.note-tab.note-sort-chosen{z-index:12}.note-list.sorting{cursor:grabbing}.note-tab.note-sort-chosen .paper{transform:scale(1.04);filter:brightness(1.055);box-shadow:0 14px 30px rgba(0,0,0,.18)}.note-tab.note-sort-ghost{opacity:.18}.note-tab.note-sort-drag .paper{filter:brightness(1.065);box-shadow:0 18px 34px rgba(0,0,0,.22)}.paper{position:absolute;inset:0;overflow:hidden;display:block;border-radius:18px 0 0 18px;background:var(--paper);box-shadow:none;transition:filter .2s ease,transform .2s var(--ease),box-shadow .2s var(--ease)}.note-tab:hover .paper{filter:brightness(1.045);box-shadow:none}.dock-left .paper{border-radius:0 18px 18px 0;box-shadow:none}.paper::after{content:"";position:absolute;inset:0;background:linear-gradient(145deg,rgba(255,255,255,.3),transparent 40%,rgba(60,45,30,.05));pointer-events:none}.paper::before{content:"";position:absolute;z-index:2;top:9px;bottom:9px;right:calc(100% - var(--spine));border-right:1px dashed rgba(72,58,43,.2)}.title{position:absolute;z-index:3;left:0;top:9px;bottom:9px;width:var(--title-width);display:grid;place-items:center;writing-mode:vertical-rl;text-orientation:upright;color:var(--paper-ink,rgb(47,42,40));font-size:var(--title-size);font-weight:700;letter-spacing:.04em;overflow:hidden;text-overflow:ellipsis}.dock-left .title{left:auto;right:0}
.quick-actions{position:absolute;z-index:4;top:0;bottom:0;right:var(--action-edge);left:calc(var(--spine) + var(--action-spine));display:flex;flex-direction:column;align-items:center;justify-content:center;gap:var(--action-gap);opacity:0;transform:translateX(7px) scale(.92);pointer-events:none;transition:opacity .16s ease,transform .22s var(--ease)}.dock-left .quick-actions{left:var(--action-edge);right:auto;transform:translateX(-7px) scale(.92)}.note-tab.actions .quick-actions{opacity:1;transform:none}.quick-actions button{width:var(--action-btn);height:var(--action-btn);padding:0;display:grid;place-items:center;border:0;border-radius:9px;color:var(--paper-ink-soft,rgba(52,45,44,.63));background:transparent;pointer-events:none;cursor:pointer;transition:color .18s ease,background .18s ease,transform .2s var(--ease)}.note-tab.actions .quick-actions button{pointer-events:auto}.quick-actions svg{width:var(--action-icon);height:var(--action-icon);fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.quick-actions button:hover{color:#fff;transform:scale(1.06)}.quick-actions button:hover:first-child{background:#5b92e8;box-shadow:none}.quick-actions button:hover:last-child{background:#ef6262;box-shadow:none}
.rail-controls{position:relative;z-index:30;width:100%;padding-top:10px;display:flex;flex:0 0 auto;flex-direction:column;align-items:flex-end;opacity:0;visibility:hidden;transform:translateX(18px);pointer-events:none}.dock-left .rail-controls{align-items:flex-start;transform:translateX(-18px)}.controls-visible .rail-controls{pointer-events:none}.rail-controls .separator{position:absolute;z-index:2;top:4px;right:0;width:40px;height:1px;margin:0;background:rgba(255,255,255,.18)}.dock-left .rail-controls .separator{right:auto;left:0}.rail-controls>button{position:relative;width:40px;height:40px;margin:0 0 6px 0;padding:0;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:50%;color:rgba(255,255,255,.82);background:rgba(24,26,31,.88);box-shadow:0 6px 18px rgba(0,0,0,.22);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);cursor:pointer;transition:color .18s ease,border-color .18s ease,box-shadow .2s var(--ease)}.dock-left .rail-controls>button{margin:0 0 6px 0}.rail-controls>button>svg{width:18px;height:18px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}.rail-controls>button:hover{color:#fff}.rail-controls>button:hover>svg{transform:scale(1.16)}.rail-controls>button:active>svg{transform:scale(.94)}
.adaptive-control.selected{color:#fff;border-color:rgba(255,255,255,.72);box-shadow:0 0 0 3px rgba(255,255,255,.14),0 7px 22px rgba(0,0,0,.3),inset 0 0 14px rgba(255,255,255,.1)}.adaptive-control.selected>svg{transform:scale(1.12)}.rail-controls>button[data-control="add"].selected>svg{transform:rotate(45deg) scale(1.06)}
.screen-compact .paper{border-radius:15px 0 0 15px}.screen-compact.dock-left .paper{border-radius:0 15px 15px 0}
@media(prefers-reduced-motion:reduce){*{scroll-behavior:auto!important}}
</style>
