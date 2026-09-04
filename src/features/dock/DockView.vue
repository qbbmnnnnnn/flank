<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { gsap } from "gsap";

import {
  DOCK_BRIDGE,
  emitToPanel,
  listenOnWebview,
  type DockPanelSavePayload,
  type Note,
} from "./bridge";

const root = ref<HTMLElement | null>(null);
const noteList = ref<HTMLElement | null>(null);
const side = ref<"left" | "right">("right");
const screenHeight = ref(1080);
const notes = ref<Note[]>([
  { id: "idea", title: "今日灵感", color: "#FFE57A", body: "让工具像家具一样安静，像朋友一样及时。\n\n☐ 调整首页留白\n☐ 试试侧边吸附\n☑ 完成窗口原型" },
  { id: "todo", title: "产品待办", color: "#FFB8A7", body: "## 高优先级\n\n- 纵向 Dock 动效\n- 便签快速唤起\n- 本地自动保存" },
  { id: "reading", title: "阅读清单", color: "#A9E5D1", body: "这个月想读：\n\n《设计中的设计》\n《毫无意义的工作》\n《制造消费者》" },
  { id: "meeting", title: "会议速记", color: "#AED6FF", body: "**Design Sync · 14:30**\n\n减少永久可见的控件，用上下文和动效去提示下一步。" },
  { id: "weekend", title: "周末计划", color: "#D8C1FF", body: "周六去植物园。\n\n带上相机、野餐布，还有那本一直没有读完的书。" },
]);

const dragging = ref(false);
const controlsVisible = ref(false);
const actionNote = ref<string | null>(null);
const peekNote = ref<string | null>(null);
const settingsSelected = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);
const toast = ref("");

// Panel coordination state (the rail is the only controller of the panel window).
const panelOpen = ref(false);
const activeNoteId = ref<string | null>(null);
const isNewNotePending = ref(false);

let context: gsap.Context | undefined;
let media: gsap.MatchMedia | undefined;
let toastTimer: number | undefined;
let settingsSelectedTimer: number | undefined;
let controlsHideTimer: number | undefined;
let controlsTimeline: gsap.core.Timeline | undefined;
let noteListObserver: ResizeObserver | undefined;
let pendingCloseTimer: number | undefined;
let unlistenPanelSave: (() => void) | undefined;
let unlistenPanelBlurred: (() => void) | undefined;
let unlistenPanelRequestClose: (() => void) | undefined;
let panelToken = 0;
let suppressBlurUntil = 0;
const hoverTimers = new Map<string, number>();
const quickSetters = new Map<HTMLElement, { x: (value: number) => void; scaleX: (value: number) => void; scaleY: (value: number) => void }>();

const compact = computed(() => screenHeight.value <= 720);

function displayTitle(title: string) {
  const chars = Array.from(title);
  return chars.length > 5 ? `${chars.slice(0, 5).join("")}…` : title;
}

function showLocalToast(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => (toast.value = ""), 1800);
}

function showToast(message: string) {
  if (!("__TAURI_INTERNALS__" in window)) {
    showLocalToast(message);
    return;
  }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("show_dock_toast", { message }))
    .catch(() => showLocalToast(message));
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
    showLocalToast("便签面板需在桌面应用中查看");
    return;
  }
  await invokeTauri("show_dock_panel", { anchorSide });
}

function hideDockPanel() {
  void invokeTauri("hide_dock_panel");
}

async function openNote(note: Note) {
  if (panelOpen.value && activeNoteId.value === note.id) {
    // Same note: the panel toggles preview/edit internally.
    suppressBlurUntil = Date.now() + 260;
    window.clearTimeout(pendingCloseTimer);
    await showDockPanel(side.value);
    await emitToPanel(DOCK_BRIDGE.open, { note, anchorSide: side.value, isNew: false, sameNote: true });
    return;
  }

  panelOpen.value = true;
  activeNoteId.value = note.id;
  isNewNotePending.value = false;
  suppressBlurUntil = Date.now() + 260;
  window.clearTimeout(pendingCloseTimer);
  panelToken += 1;
  await showDockPanel(side.value);
  await emitToPanel(DOCK_BRIDGE.open, { note, anchorSide: side.value, isNew: false, sameNote: false });
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
  await emitToPanel(DOCK_BRIDGE.open, { note: null, anchorSide: side.value, isNew: true, sameNote: false });
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
  if (payload.isNew) {
    notes.value.unshift(payload.note);
    isNewNotePending.value = false;
  } else {
    const target = notes.value.find((item) => item.id === payload.note.id);
    if (target) {
      target.title = payload.note.title;
      target.body = payload.note.body;
      target.color = payload.note.color;
    }
  }
  if (panelOpen.value) activeNoteId.value = payload.note.id;
  nextTick(() => {
    setupQuickSetters();
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
  if (dragging.value) return;
  showControls();
  const direction = inward();
  const hovered = (event.target as HTMLElement).closest<HTMLElement>(".note-tab");
  const tabs = [...(root.value?.querySelectorAll<HTMLElement>(".note-tab") ?? [])];
  let nearest: HTMLElement | null = null;
  let nearestDistance = Number.POSITIVE_INFINITY;

  for (const tab of tabs) {
    const rect = tab.getBoundingClientRect();
    const distance = Math.abs(event.clientY - (rect.top + rect.height / 2));
    const influence = gsap.utils.clamp(0, 1, 1 - distance / 132);
    const scale = 1 + influence * .14;
    let x = gsap.utils.mapRange(0, 1, 0, 24 * direction, influence);
    if (tab.dataset.id === activeNoteId.value) x += 20 * direction;
    if (tab === hovered && tab.dataset.id) {
      x = gsap.utils.mapRange(0, 1, 0, 4 * direction, influence);
      x += (actionNote.value === tab.dataset.id ? 42 : 20) * direction;
    }
    quickSetters.get(tab)?.scaleX(scale);
    quickSetters.get(tab)?.scaleY(scale);
    quickSetters.get(tab)?.x(x);
    if (distance < nearestDistance) {
      nearest = tab;
      nearestDistance = distance;
    }
  }
  tabs.forEach((tab) => tab.classList.toggle("nearest", tab === nearest && nearestDistance < 58));
}

function resetRail() {
  actionNote.value = null;
  peekNote.value = null;
  root.value?.querySelectorAll<HTMLElement>(".note-tab").forEach((tab) => {
    quickSetters.get(tab)?.scaleX(1);
    quickSetters.get(tab)?.scaleY(1);
    quickSetters.get(tab)?.x(tab.dataset.id === activeNoteId.value ? 20 * inward() : 0);
    tab.classList.remove("nearest");
  });
}

function beginHover(note: Note) {
  window.clearTimeout(hoverTimers.get(note.id));
  peekNote.value = note.id;
  const tab = findTab(note.id);
  if (tab) quickSetters.get(tab)?.x(20 * inward());
  const timer = window.setTimeout(() => {
    if (peekNote.value !== note.id || dragging.value) return;
    actionNote.value = note.id;
    const current = findTab(note.id);
    if (current) quickSetters.get(current)?.x(42 * inward());
  }, 1000);
  hoverTimers.set(note.id, timer);
}

function endHover(note: Note) {
  window.clearTimeout(hoverTimers.get(note.id));
  if (peekNote.value === note.id) peekNote.value = null;
  if (actionNote.value === note.id) actionNote.value = null;
  const tab = findTab(note.id);
  if (tab) quickSetters.get(tab)?.x(note.id === activeNoteId.value ? 20 * inward() : 0);
}

function controlElements() {
  const scope = root.value;
  return {
    grabZone: scope?.querySelector<HTMLElement>(".grab-zone") ?? null,
    dragHandle: scope?.querySelector<HTMLElement>(".drag-handle") ?? null,
    controls: scope?.querySelector<HTMLElement>(".rail-controls") ?? null,
    actions: [...(scope?.querySelectorAll<HTMLElement>(".rail-controls > button") ?? [])],
  };
}

function buildControlsTimeline() {
  const { grabZone, dragHandle, controls, actions } = controlElements();
  controlsTimeline?.kill();
  gsap.killTweensOf([grabZone, dragHandle, controls, ...actions]);
  const duration = isReducedMotion() ? 0 : .42;
  controlsTimeline = gsap.timeline({ paused: true, defaults: { overwrite: "auto" } })
    .fromTo(grabZone, { autoAlpha: 0, y: 20 }, { autoAlpha: 1, y: 0, duration: duration * .55, ease: "power2.out" }, 0)
    .fromTo(dragHandle, { autoAlpha: 0, y: 24, scale: .82 }, { autoAlpha: 1, y: 0, scale: 1, duration, ease: "back.out(1.9)" }, 0)
    .fromTo(controls, { autoAlpha: 0, x: 18 * -inward() }, { autoAlpha: 1, x: 0, duration: duration * .55, ease: "power2.out" }, 0)
    .fromTo(actions, { autoAlpha: 0, y: -30, scale: .76 }, { autoAlpha: 1, y: 0, scale: 1, duration, stagger: isReducedMotion() ? 0 : .12, ease: "back.out(1.9)" }, isReducedMotion() ? 0 : .08);
}

function showControls() {
  window.clearTimeout(controlsHideTimer);
  if (dragging.value || controlsVisible.value) return;
  controlsVisible.value = true;
  nextTick(() => {
    if (!controlsTimeline) buildControlsTimeline();
    controlsTimeline?.play();
  });
}

function hideControls(force = false) {
  window.clearTimeout(controlsHideTimer);
  if (dragging.value && !force) return;
  controlsVisible.value = false;
  if (force || isReducedMotion()) {
    controlsTimeline?.kill();
    controlsTimeline = undefined;
    const { grabZone, dragHandle, controls, actions } = controlElements();
    gsap.set([grabZone, dragHandle, controls, ...actions], { autoAlpha: 0 });
    return;
  }
  controlsTimeline?.reverse();
}

function onRailLeave() {
  if (dragging.value) return;
  resetRail();
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => hideControls(), 1200);
}

// ---------------------------------------------------------------------------
// Note actions
// ---------------------------------------------------------------------------

function archiveNote(note: Note) {
  notes.value = notes.value.filter((item) => item.id !== note.id);
  quickSetters.delete(findTab(note.id) as HTMLElement);
  if (activeNoteId.value === note.id) void closePanel();
  showToast(`“${note.title}”已归档`);
}

function deleteNote(note: Note) {
  notes.value = notes.value.filter((item) => item.id !== note.id);
  quickSetters.delete(findTab(note.id) as HTMLElement);
  if (activeNoteId.value === note.id) void closePanel();
  showToast(`“${note.title}”已移到废纸篓`);
}

// ---------------------------------------------------------------------------
// Drag / snap
// ---------------------------------------------------------------------------

async function snapNativeWindow() {
  const win = await getDockWindow();
  if (!win) return;
  try {
    const [{ monitorFromPoint }, { PhysicalPosition }, position, size, scaleFactor] = await Promise.all([
      import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"), win.outerPosition(), win.outerSize(), win.scaleFactor(),
    ]);
    const railWidth = 104 * scaleFactor;
    const centerX = position.x + (side.value === "right" ? size.width - railWidth / 2 : railWidth / 2);
    const centerY = position.y + size.height / 2;
    const monitor = await monitorFromPoint(centerX, centerY);
    if (!monitor) return;
    await updateDisplayMetrics(monitor);
    side.value = centerX < monitor.position.x + monitor.size.width / 2 ? "left" : "right";
    const target = {
      x: side.value === "left" ? monitor.position.x : monitor.position.x + monitor.size.width - size.width,
      y: gsap.utils.clamp(monitor.position.y + 8, monitor.position.y + monitor.size.height - size.height - 8, position.y),
    };
    if (isReducedMotion()) await win.setPosition(new PhysicalPosition(target.x, target.y));
    else {
      await new Promise<void>((resolve) => {
        const point = { x: position.x, y: position.y };
        gsap.to(point, {
          ...target, duration: .34, ease: "back.out(1.28)",
          onUpdate: () => void win.setPosition(new PhysicalPosition(Math.round(point.x), Math.round(point.y))),
          onComplete: resolve,
        });
      });
    }
  } catch {
    // Keep the current position if a window manager rejects repositioning.
  }
}

async function beginWindowDrag(event: PointerEvent) {
  if (event.button !== 0 || dragging.value) return;
  event.preventDefault();
  const dragTarget = event.currentTarget as HTMLElement;
  const pointerId = event.pointerId;
  let latestPointer = { x: event.screenX, y: event.screenY };
  let released = false;
  let moveWindow: (() => void) | undefined;
  let resolveRelease: (() => void) | undefined;
  const releasePromise = new Promise<void>((resolve) => (resolveRelease = resolve));
  const onMove = (moveEvent: PointerEvent) => {
    if (moveEvent.pointerId !== pointerId) return;
    latestPointer = { x: moveEvent.screenX, y: moveEvent.screenY };
    moveWindow?.();
  };
  const onRelease = (upEvent: PointerEvent) => {
    if (upEvent.pointerId !== pointerId || released) return;
    if (upEvent.type === "pointerup") latestPointer = { x: upEvent.screenX, y: upEvent.screenY };
    released = true;
    resolveRelease?.();
  };
  const cleanupPointer = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onRelease);
    window.removeEventListener("pointercancel", onRelease);
    if (dragTarget.hasPointerCapture?.(pointerId)) dragTarget.releasePointerCapture(pointerId);
  };

  dragTarget.setPointerCapture?.(pointerId);
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onRelease);
  window.addEventListener("pointercancel", onRelease);
  const winPromise = getDockWindow();
  if (panelOpen.value) await closePanel();
  dragging.value = true;
  resetRail();
  hideControls(true);
  await nextTick();
  const handle = root.value?.querySelector<HTMLElement>(".drag-handle");
  if (handle) gsap.set(handle, { autoAlpha: 1, y: 0, scale: 1 });
  const win = await winPromise;
  if (!win) {
    cleanupPointer();
    if (released) {
      dragging.value = false;
      showControlsAfterDrag();
    } else {
      beginBrowserDrag(event);
    }
    return;
  }

  try {
    const [{ PhysicalPosition }, startPosition, scaleFactor] = await Promise.all([
      import("@tauri-apps/api/dpi"), win.outerPosition(), win.scaleFactor(),
    ]);
    const startPointer = { x: latestPointer.x * scaleFactor, y: latestPointer.y * scaleFactor };
    let pendingPosition: InstanceType<typeof PhysicalPosition> | null = null;
    let moving = false;
    let movementPromise = Promise.resolve();

    moveWindow = () => {
      pendingPosition = new PhysicalPosition(
        Math.round(startPosition.x + latestPointer.x * scaleFactor - startPointer.x),
        Math.round(startPosition.y + latestPointer.y * scaleFactor - startPointer.y),
      );
      if (moving) return;
      moving = true;
      movementPromise = (async () => {
        while (pendingPosition) {
          const position = pendingPosition;
          pendingPosition = null;
          await win.setPosition(position);
        }
        moving = false;
      })().catch(() => {
        pendingPosition = null;
        moving = false;
      });
    };

    if (!released) await releasePromise;
    moveWindow();
    await movementPromise;
  } catch {
    // Keep the last accepted position when manual movement is unavailable.
  } finally {
    cleanupPointer();
  }

  await snapNativeWindow();
  dragging.value = false;
  showControlsAfterDrag();
}

function showControlsAfterDrag() {
  controlsVisible.value = false;
  nextTick(showControls);
  showToast(side.value === "left" ? "便签栏已吸附到左侧" : "便签栏已吸附到右侧");
}

function beginBrowserDrag(event: PointerEvent) {
  const rail = root.value?.querySelector<HTMLElement>(".dock-rail");
  if (!rail) return;
  const rect = rail.getBoundingClientRect();
  rail.style.right = "auto";
  rail.style.left = `${rect.left}px`;
  rail.style.top = `${rect.top}px`;
  rail.style.transform = "none";
  const startX = event.clientX;
  const startY = event.clientY;
  const onMove = (e: PointerEvent) => {
    rail.style.left = `${gsap.utils.clamp(0, window.innerWidth - rect.width, rect.left + e.clientX - startX)}px`;
    rail.style.top = `${gsap.utils.clamp(8, window.innerHeight - rect.height - 8, rect.top + e.clientY - startY)}px`;
  };
  const onUp = (e: PointerEvent) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onUp);
    const nextSide = e.clientX < window.innerWidth / 2 ? "left" : "right";
    const targetLeft = nextSide === "left" ? 0 : window.innerWidth - rect.width;
    const targetTop = gsap.utils.clamp(8, window.innerHeight - rect.height - 8, Number.parseFloat(rail.style.top));
    gsap.to(rail, {
      left: targetLeft, top: targetTop, duration: isReducedMotion() ? 0 : .34, ease: "back.out(1.28)",
      onComplete: () => {
        side.value = nextSide;
        rail.style.left = nextSide === "left" ? "0px" : "auto";
        rail.style.right = nextSide === "right" ? "0px" : "auto";
        rail.style.top = `${targetTop}px`;
        dragging.value = false;
        showControlsAfterDrag();
      },
    });
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onUp);
}

async function toggleSideWithKeyboard() {
  const nextSide = side.value === "right" ? "left" : "right";
  const win = await getDockWindow();
  if (!win) {
    side.value = nextSide;
    showToast(nextSide === "left" ? "便签栏已吸附到左侧" : "便签栏已吸附到右侧");
    return;
  }
  try {
    const [{ currentMonitor }, { PhysicalPosition }, position, size] = await Promise.all([
      import("@tauri-apps/api/window"), import("@tauri-apps/api/dpi"), win.outerPosition(), win.outerSize(),
    ]);
    const monitor = await currentMonitor();
    if (monitor) {
      await updateDisplayMetrics(monitor);
      const x = nextSide === "left" ? monitor.position.x : monitor.position.x + monitor.size.width - size.width;
      const y = gsap.utils.clamp(monitor.position.y + 8, monitor.position.y + monitor.size.height - size.height - 8, position.y);
      await win.setPosition(new PhysicalPosition(x, y));
    }
    side.value = nextSide;
    showToast(nextSide === "left" ? "便签栏已吸附到左侧" : "便签栏已吸附到右侧");
  } catch {
    showToast("无法移动便签栏，请检查窗口权限");
  }
}

async function openSettings() {
  window.clearTimeout(settingsSelectedTimer);
  settingsSelected.value = true;
  settingsSelectedTimer = window.setTimeout(() => (settingsSelected.value = false), 650);
  try {
    const { getAllWebviewWindows } = await import("@tauri-apps/api/webviewWindow");
    const main = (await getAllWebviewWindows()).find((item) => item.label === "main");
    await main?.show();
    await main?.setFocus();
  } catch {
    showToast("已打开设置");
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

watch(() => notes.value.length, () => nextTick(updateScrollEdges));

onMounted(async () => {
  document.documentElement.classList.add("dock-document");
  document.body.classList.add("dock-document");
  await updateDisplayMetrics();
  setupQuickSetters();
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

  const dockWindow = await getDockWindow();
  await dockWindow?.show();
});

onUnmounted(() => {
  document.documentElement.classList.remove("dock-document");
  document.body.classList.remove("dock-document");
  window.clearTimeout(toastTimer);
  window.clearTimeout(settingsSelectedTimer);
  window.clearTimeout(controlsHideTimer);
  window.clearTimeout(pendingCloseTimer);
  hoverTimers.forEach((timer) => window.clearTimeout(timer));
  noteListObserver?.disconnect();
  unlistenPanelSave?.();
  unlistenPanelBlurred?.();
  unlistenPanelRequestClose?.();
  controlsTimeline?.kill();
  if (root.value) gsap.killTweensOf(root.value.querySelectorAll("*"));
  media?.revert();
  context?.revert();
});
</script>

<template>
  <main ref="root" class="dock-window" :class="[`dock-${side}`, { dragging, 'screen-compact': compact }]" :style="{ '--screen-height': `${screenHeight}px` }" @keydown="onRootKeydown" @pointerdown="onRootPointerDown">
    <aside class="dock-rail" :class="{ 'controls-visible': controlsVisible }" aria-label="便签栏" @pointermove="onRailMove" @pointerleave="onRailLeave">
      <div class="grab-zone">
        <button class="drag-handle adaptive-control" :class="{ selected: dragging }" data-control="handle" type="button" draggable="false" aria-label="拖动便签栏" :aria-pressed="dragging ? 'true' : 'false'" title="拖动便签栏" @pointerdown.left="beginWindowDrag" @keydown.enter.prevent="toggleSideWithKeyboard" @keydown.space.prevent="toggleSideWithKeyboard"><span><i></i><i></i><i></i><i></i><i></i><i></i></span></button>
      </div>
      <div class="note-list-shell" :class="{ 'blur-top': canScrollUp, 'blur-bottom': canScrollDown }">
        <div ref="noteList" class="note-list" @scroll="updateScrollEdges" @pointerenter="showControls">
        <div v-for="note in notes" :key="note.id" class="note-tab" :class="{ active: activeNoteId === note.id, actions: actionNote === note.id }" :data-id="note.id" role="button" tabindex="0" draggable="false" :aria-label="`打开${note.title}`" @pointerenter="beginHover(note)" @pointerleave="endHover(note)" @click="openNote(note)" @keydown.enter.prevent="openNote(note)" @keydown.space.prevent="openNote(note)">
          <span class="paper" :style="{ '--paper': note.color }"><span class="title">{{ displayTitle(note.title) }}</span><span class="quick-actions"><button type="button" title="归档" aria-label="归档" @click.stop="archiveNote(note)"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></svg></button><button type="button" title="删除" aria-label="删除" @click.stop="deleteNote(note)"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></span></span>
        </div>
        </div>
      </div>
      <div class="rail-controls"><span class="separator"></span>
        <button class="adaptive-control" :class="{ selected: isNewNotePending }" data-control="add" type="button" aria-label="新建便签" :aria-pressed="isNewNotePending ? 'true' : 'false'" @click="createNote"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="adaptive-control" :class="{ selected: settingsSelected }" data-control="settings" type="button" aria-label="打开设置" @click="openSettings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.38.73.6 1 .28.34.67.54 1.1.6H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg></button>
      </div>
    </aside>

    <Transition name="toast"><div v-if="toast" class="dock-toast" role="status">{{ toast }}</div></Transition>
  </main>
</template>

<style scoped>
.dock-window{--rail:104px;--ease:cubic-bezier(.22,1,.36,1);width:100vw;height:100vh;position:relative;overflow:hidden;color:#29262b;background:transparent;pointer-events:none;user-select:none;-webkit-user-select:none}.dock-window svg,.note-tab,.paper{-webkit-user-drag:none}.note-tab,.drag-handle,.rail-controls>button{pointer-events:auto}.dock-rail{position:absolute;z-index:5;top:50%;right:0;width:var(--rail);height:min(calc(var(--screen-height) - 16px),calc(100vh - 16px));padding:3px 0;display:flex;flex-direction:column;align-items:flex-end;transform:translateY(-50%);perspective:700px;pointer-events:none}.dock-left .dock-rail{left:0;right:auto;align-items:flex-start}
.grab-zone{width:100%;height:38px;flex:0 0 38px;display:flex;align-items:center;justify-content:flex-end;opacity:0;visibility:hidden;transform:translateY(20px);pointer-events:none}.dock-left .grab-zone{justify-content:flex-start}.controls-visible .grab-zone,.dragging .grab-zone{pointer-events:none}.drag-handle{width:48px;height:32px;margin-right:8px;padding:0;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:11px;color:rgba(255,255,255,.82);background:rgba(24,26,31,.88);box-shadow:0 5px 16px rgba(0,0,0,.2);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);cursor:grab;touch-action:none;transition:color .18s ease,border-color .18s ease,box-shadow .2s var(--ease)}.dock-left .drag-handle{margin:0 0 0 8px}.drag-handle>span{width:18px;display:grid;grid-template-columns:repeat(3,4px);grid-template-rows:repeat(2,4px);justify-content:space-between;gap:3px}.drag-handle i{width:4px;height:4px;border-radius:50%;background:currentColor}.drag-handle:hover{color:#fff}.drag-handle:active,.dragging .drag-handle{cursor:grabbing}
.note-list-shell{position:relative;width:100%;min-height:0;max-height:min(calc(var(--screen-height) - 228px),calc(100vh - 156px));flex:1 1 auto;overflow:hidden;pointer-events:none}.note-list-shell::before,.note-list-shell::after{content:"";position:absolute;z-index:20;left:0;right:0;height:24px;opacity:0;pointer-events:none;transition:opacity .18s ease;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}.note-list-shell::before{top:0;mask-image:linear-gradient(to bottom,#000,transparent);-webkit-mask-image:linear-gradient(to bottom,#000,transparent)}.note-list-shell::after{bottom:0;mask-image:linear-gradient(to top,#000,transparent);-webkit-mask-image:linear-gradient(to top,#000,transparent)}.note-list-shell.blur-top::before,.note-list-shell.blur-bottom::after{opacity:1}.note-list{width:100%;height:100%;max-height:none;padding:10px 0 15px;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scroll-behavior:smooth;scrollbar-width:none}.blur-top:not(.blur-bottom) .note-list{mask-image:linear-gradient(to bottom,transparent 0,#000 22px);-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 22px)}.blur-bottom:not(.blur-top) .note-list{mask-image:linear-gradient(to bottom,#000 calc(100% - 22px),transparent 100%);-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 22px),transparent 100%)}.blur-top.blur-bottom .note-list{mask-image:linear-gradient(to bottom,transparent 0,#000 22px,#000 calc(100% - 22px),transparent 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 22px,#000 calc(100% - 22px),transparent 100%)}.note-list::-webkit-scrollbar{display:none}.dock-left .note-list{align-items:flex-start}.note-tab{position:relative;width:88px;height:126px;flex:0 0 126px;margin:0 -48px 0 0;padding:0;border:0;color:#302c2e;background:transparent;cursor:pointer;transform-origin:right center;will-change:transform;rotate:var(--tilt,0deg)}.note-tab+.note-tab{margin-top:-16px}.dock-left .note-tab{margin-right:0;margin-left:-48px;transform-origin:left center}.note-tab:nth-child(1){--tilt:-1.8deg;z-index:1}.note-tab:nth-child(2){--tilt:.9deg;z-index:2}.note-tab:nth-child(3){--tilt:-1.1deg;z-index:3}.note-tab:nth-child(4){--tilt:1.25deg;z-index:4}.note-tab:nth-child(5){--tilt:-1.35deg;z-index:5}.note-tab:nth-child(n+6){--tilt:-1deg}.note-tab.nearest,.note-tab.active,.note-tab:hover{z-index:12}.paper{position:absolute;inset:0;overflow:hidden;display:block;border-radius:18px 0 0 18px;background:var(--paper);box-shadow:none;transition:filter .2s ease}.note-tab:hover .paper{filter:brightness(1.045);box-shadow:none}.dock-left .paper{border-radius:0 18px 18px 0;box-shadow:none}.paper::after{content:"";position:absolute;inset:0;background:linear-gradient(145deg,rgba(255,255,255,.3),transparent 40%,rgba(60,45,30,.05));pointer-events:none}.paper::before{content:"";position:absolute;z-index:2;top:9px;bottom:9px;right:50%;border-right:1px dashed rgba(72,58,43,.2)}.title{position:absolute;z-index:3;left:0;top:9px;bottom:9px;width:38px;display:grid;place-items:center;writing-mode:vertical-rl;text-orientation:upright;color:rgba(47,42,40,.78);font-size:14px;font-weight:800;letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis}.dock-left .title{left:auto;right:0}
.quick-actions{position:absolute;z-index:4;right:7px;top:0;bottom:0;width:45px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0;transform:translateX(7px) scale(.92);pointer-events:none;transition:opacity .16s ease,transform .22s var(--ease)}.dock-left .quick-actions{left:7px;right:auto;transform:translateX(-7px) scale(.92)}.note-tab.actions .quick-actions{opacity:1;transform:none;pointer-events:auto}.quick-actions button{width:31px;height:31px;padding:0;display:grid;place-items:center;border:0;border-radius:10px;color:rgba(52,45,44,.63);background:transparent;cursor:pointer;transition:color .18s ease,background .18s ease,transform .2s var(--ease)}.quick-actions svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.quick-actions button:hover{color:#fff;transform:scale(1.06)}.quick-actions button:hover:first-child{background:#5b92e8;box-shadow:none}.quick-actions button:hover:last-child{background:#ef6262;box-shadow:none}
.rail-controls{position:relative;z-index:30;width:100%;padding-top:0;display:flex;flex:0 0 auto;flex-direction:column;align-items:flex-end;opacity:0;visibility:hidden;transform:translateX(18px);pointer-events:none}.dock-left .rail-controls{align-items:flex-start;transform:translateX(-18px)}.controls-visible:not(.dragging) .rail-controls{pointer-events:none}.rail-controls .separator{position:absolute;top:-8px;right:0;width:54px;height:1px;margin:0;background:rgba(255,255,255,.18)}.dock-left .rail-controls .separator{right:auto;left:0}.rail-controls>button{position:relative;width:48px;height:48px;margin:0 4px 6px 0;padding:0;display:grid;place-items:center;border:1px solid rgba(255,255,255,.22);border-radius:50%;color:rgba(255,255,255,.82);background:rgba(24,26,31,.88);box-shadow:0 6px 18px rgba(0,0,0,.22);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);cursor:pointer;transition:color .18s ease,border-color .18s ease,box-shadow .2s var(--ease)}.dock-left .rail-controls>button{margin-right:0;margin-left:4px}.rail-controls>button>svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}.rail-controls>button:hover{color:#fff}.rail-controls>button:hover>svg{transform:scale(1.16)}.rail-controls>button:active>svg{transform:scale(.94)}
.adaptive-control.selected{color:#fff;border-color:rgba(255,255,255,.72);box-shadow:0 0 0 3px rgba(255,255,255,.14),0 7px 22px rgba(0,0,0,.3),inset 0 0 14px rgba(255,255,255,.1)}.adaptive-control.selected>svg{transform:scale(1.12)}.rail-controls>button[data-control="add"].selected>svg{transform:rotate(45deg) scale(1.06)}.drag-handle.selected>span{filter:drop-shadow(0 0 4px rgba(255,255,255,.75))}
.dragging .dock-rail{z-index:50}.dragging .note-list{mask-image:none;-webkit-mask-image:none;align-items:flex-end}.dock-left.dragging .note-list{align-items:flex-end}.dragging .note-tab{width:96px;height:96px;flex-basis:96px;margin:-4px 0 0!important;transform-origin:center}.dragging .paper{border-radius:16px!important;animation:wiggle .22s ease-in-out infinite alternate}.dragging .note-tab:nth-child(2n) .paper{animation-delay:-.11s}.dragging .note-tab:nth-child(3n) .paper{animation-delay:-.055s}.dragging .title{inset:0;width:auto;writing-mode:horizontal-tb;text-orientation:mixed;letter-spacing:.04em}.dragging .paper::before,.dragging .quick-actions,.dragging .rail-controls{display:none}.screen-compact .note-list-shell{max-height:min(calc(var(--screen-height) - 224px),calc(100vh - 170px))}.screen-compact .note-list{gap:1px}.screen-compact .note-tab{height:104px;flex-basis:104px}.screen-compact .note-tab+.note-tab{margin-top:-14px}.screen-compact .paper{border-radius:15px 0 0 15px}.screen-compact.dock-left .paper{border-radius:0 15px 15px 0}.screen-compact .title{font-size:12px;letter-spacing:.02em}.screen-compact.dragging .note-tab{width:88px;height:88px;flex-basis:88px}.screen-compact.dragging .paper{border-radius:15px!important}
.dock-toast{position:absolute;z-index:60;left:50%;bottom:16px;padding:9px 13px;border:1px solid rgba(255,255,255,.13);border-radius:10px;color:#fff;background:rgba(28,26,32,.86);box-shadow:none;transform:translateX(-50%);font-size:10px;white-space:nowrap}.toast-enter-active,.toast-leave-active{transition:opacity .16s ease,transform .2s ease}.toast-enter-from,.toast-leave-to{opacity:0;transform:translate(-50%,7px)}@keyframes wiggle{from{transform:rotate(-2deg) translate3d(-1px,0,0)}to{transform:rotate(2deg) translate3d(1px,-1px,0)}}
@media(prefers-reduced-motion:reduce){.dragging .paper{animation:none!important}*{scroll-behavior:auto!important}}
</style>
