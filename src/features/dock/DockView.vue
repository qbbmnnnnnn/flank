<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import { gsap } from "gsap";

interface Note {
  id: string;
  title: string;
  body: string;
  color: string;
}

type EditorMode = "closed" | "preview" | "edit";
type ControlTone = "light" | "dark";
type PreviewLine = {
  kind: "heading" | "task" | "list" | "quote" | "paragraph";
  html: string;
  index: number;
  level?: 1 | 2 | 3;
  checked?: boolean;
};

const root = ref<HTMLElement | null>(null);
const editorBody = ref<HTMLElement | null>(null);
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

const mode = ref<EditorMode>("closed");
const activeNote = ref<Note | null>(null);
const draftTarget = ref<Note | null>(null);
const draftTitle = ref("");
const draftBody = ref("");
const draftColor = ref("#FFE57A");
const isNewNote = ref(false);
const saveState = ref<"idle" | "typing" | "saving" | "saved">("idle");
const toast = ref("");
const dragging = ref(false);
const controlsVisible = ref(false);
const actionNote = ref<string | null>(null);
const peekNote = ref<string | null>(null);
const controlTones = ref<Record<"handle" | "add" | "settings", ControlTone>>({ handle: "light", add: "light", settings: "light" });
const panelPending = ref(false);
const canScrollUp = ref(false);
const canScrollDown = ref(false);

const palette = ["#FFE57A", "#FFB8A7", "#F5B8CD", "#D8C1FF", "#AED6FF", "#A9E5D1"];
let context: gsap.Context | undefined;
let media: gsap.MatchMedia | undefined;
let saveTimer: number | undefined;
let saveStateTimer: number | undefined;
let toastTimer: number | undefined;
let contrastTimer: number | undefined;
let controlsHideTimer: number | undefined;
let controlsTimeline: gsap.core.Timeline | undefined;
let noteListObserver: ResizeObserver | undefined;
let unlistenDockFocus: (() => void) | undefined;
let panelAnimation: gsap.core.Timeline | undefined;
let closingPanel = false;
let switchingPanel = false;
const hoverTimers = new Map<string, number>();
const quickSetters = new Map<HTMLElement, { x: (value: number) => void; scaleX: (value: number) => void; scaleY: (value: number) => void }>();

const compact = computed(() => screenHeight.value <= 720);
const previewLines = computed<PreviewLine[]>(() => parseMarkdown(activeNote.value?.body ?? ""));

function displayTitle(title: string) {
  const chars = Array.from(title);
  return chars.length > 6 ? `${chars.slice(0, 5).join("")}…` : title;
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
      // quickTo cannot reliably reset the compound `scale` alias in GSAP 3.15.
      // Drive both axes independently to avoid "scale not eligible for reset".
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

async function waitForDockViewportWidth(expectedWidth: number) {
  const deadline = performance.now() + 240;
  while (window.innerWidth < expectedWidth - 1 && performance.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }
  // Non-Windows fallbacks still resize the host. Wait for the WebView layout
  // and compositor frames before panel content can safely become visible.
  await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
}

async function resizeForPanel(expanded: boolean) {
  const win = await getDockWindow();
  if (!win) return;
  try {
    const newWidth = expanded ? 500 : 104;
    if ("__TAURI_INTERNALS__" in window) {
      const { invoke } = await import("@tauri-apps/api/core");
      // Resize the real native window instead of clipping a permanently wide
      // transparent HWND; this avoids stale WebView2/DWM caption artifacts.
      await invoke("resize_dock_window", { logicalWidth: newWidth, anchorRight: side.value === "right" });
      if (expanded) await waitForDockViewportWidth(newWidth);
      return;
    }
    const [{ LogicalPosition, LogicalSize }, physicalPosition, physicalSize, scaleFactor] = await Promise.all([
      import("@tauri-apps/api/dpi"),
      win.outerPosition(),
      win.outerSize(),
      win.scaleFactor(),
    ]);
    const oldWidth = physicalSize.width / scaleFactor;
    const logicalX = physicalPosition.x / scaleFactor;
    const logicalY = physicalPosition.y / scaleFactor;
    const sizeUpdate = win.setSize(new LogicalSize(newWidth, physicalSize.height / scaleFactor));
    if (side.value === "right") {
      // Dispatch both native changes together. Moving the still-narrow window
      // first briefly dragged the entire rail left before the resize arrived.
      await Promise.all([
        sizeUpdate,
        win.setPosition(new LogicalPosition(logicalX + oldWidth - newWidth, logicalY)),
      ]);
    } else {
      await sizeUpdate;
    }
    if (expanded) await waitForDockViewportWidth(newWidth);
  } catch {
    // Browser preview keeps the CSS interaction working.
  }
}

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
    if (tab.dataset.id === activeNote.value?.id) x += 20 * direction;
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
    quickSetters.get(tab)?.x(tab.dataset.id === activeNote.value?.id ? 20 * inward() : 0);
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
  if (tab) quickSetters.get(tab)?.x(note.id === activeNote.value?.id ? 20 * inward() : 0);
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
  // The same timeline runs backwards, so every control retracts along the
  // exact path and in the opposite order in which it appeared.
  controlsTimeline?.reverse();
}

function onRailLeave() {
  if (dragging.value) return;
  resetRail();
  window.clearTimeout(controlsHideTimer);
  controlsHideTimer = window.setTimeout(() => hideControls(), 1200);
}

function playPanelEntrance(panel: HTMLElement) {
  panelAnimation?.kill();
  gsap.killTweensOf(panel);

  if (isReducedMotion()) {
    panelPending.value = false;
    gsap.set(panel, { clearProps: "transform,opacity,visibility" });
    return;
  }

  // The paper starts completely beyond the screen edge, flies inward at an
  // angle, then uses a short counter-swing to settle without scaling flashes.
  const direction = inward();
  const offscreenX = -(panel.offsetWidth + 128) * direction;
  gsap.set(panel, {
    x: offscreenX,
    rotation: -9 * direction,
    autoAlpha: 0,
    transformOrigin: side.value === "left" ? "left 42%" : "right 42%",
  });
  panelPending.value = false;
  panelAnimation = gsap.timeline({ defaults: { overwrite: "auto" } })
    .set(panel, { autoAlpha: 1 })
    .to(panel, { x: 12 * direction, rotation: 2.2 * direction, duration: .56, ease: "power3.out" })
    .to(panel, { x: 0, rotation: 0, duration: .3, ease: "back.out(1.7)", clearProps: "transform,opacity,visibility" });
}

async function openPreview(note: Note) {
  const wasClosed = mode.value === "closed";
  const isSwitch = !wasClosed && activeNote.value?.id !== note.id;
  if (switchingPanel) return;
  if (mode.value === "preview" && activeNote.value?.id === note.id) {
    editNote();
    return;
  }
  if (mode.value === "edit" && activeNote.value?.id === note.id && !isNewNote.value) {
    await finishEditing();
    return;
  }
  if (mode.value === "edit") flushSave();

  switchingPanel = isSwitch;
  try {
    const currentPanel = root.value?.querySelector<HTMLElement>(".note-panel");
    if (currentPanel && isSwitch && !isReducedMotion()) {
      panelAnimation?.kill();
      const direction = inward();
      const offscreenX = -(currentPanel.offsetWidth + 128) * direction;
      panelAnimation = gsap.timeline({ defaults: { overwrite: "auto" } })
        .to(currentPanel, { x: 10 * direction, rotation: -1.5 * direction, duration: .1, ease: "power1.out" })
        .to(currentPanel, { x: offscreenX, rotation: 8 * direction, autoAlpha: 0, duration: .28, ease: "power3.in" });
      await panelAnimation;
    }

    // Keep the panel unpainted until both the native window and WebView viewport
    // have reached the expanded geometry. This specifically avoids the first
    // right-edge open painting against the old 104px backing surface.
    panelPending.value = wasClosed;
    if (wasClosed) await resizeForPanel(true);
    activeNote.value = note;
    draftTarget.value = null;
    isNewNote.value = false;
    mode.value = "preview";
    actionNote.value = null;
    await nextTick();

    const panel = root.value?.querySelector<HTMLElement>(".note-panel");
    if (panel && (wasClosed || isSwitch)) {
      playPanelEntrance(panel);
    }
    resetRail();
  } finally {
    switchingPanel = false;
  }
}

async function closePreview() {
  if (mode.value === "closed" || closingPanel || switchingPanel) return;
  closingPanel = true;
  if (mode.value === "edit") flushSave();
  const panel = root.value?.querySelector<HTMLElement>(".note-panel");
  panelAnimation?.kill();
  panelAnimation = undefined;
  if (panel && !isReducedMotion()) {
    gsap.killTweensOf(panel);
    await gsap.to(panel, { autoAlpha: 0, x: 42 * -inward(), rotation: 2.5 * -inward(), duration: .2, ease: "power2.in" });
  }
  mode.value = "closed";
  panelPending.value = false;
  activeNote.value = null;
  draftTarget.value = null;
  isNewNote.value = false;
  await resizeForPanel(false);
  resetRail();
  closingPanel = false;
} 

function setSaveState(state: typeof saveState.value) {
  window.clearTimeout(saveStateTimer);
  saveState.value = state;
  if (state === "saved") saveStateTimer = window.setTimeout(() => (saveState.value = "idle"), 1800);
}

function scheduleSave() {
  if (mode.value !== "edit") return;
  syncDraftBody();
  setSaveState("typing");
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => flushSave(), 900);
}

function derivedTitle(body: string) {
  const line = body.split("\n").find((value) => value.trim()) ?? "";
  return line.replace(/^\s*(?:#{1,6}|[-*>]|☐|☑)\s*/, "").replace(/[*_`~]/g, "").slice(0, 28);
}

function flushSave() {
  window.clearTimeout(saveTimer);
  syncDraftBody();
  const body = draftBody.value.replace(/^\n+|\n+$/g, "");
  if (!draftTitle.value.trim() && !body && isNewNote.value && !draftTarget.value) {
    setSaveState("idle");
    return null;
  }

  setSaveState("saving");
  const title = draftTitle.value.trim() || derivedTitle(body) || "未命名便签";
  let target = draftTarget.value;
  let inserted = false;
  if (!target) {
    target = { id: crypto.randomUUID(), title, body, color: draftColor.value };
    notes.value.unshift(target);
    draftTarget.value = target;
    inserted = true;
  } else {
    target.title = title;
    target.body = body;
    if (isNewNote.value) target.color = draftColor.value;
  }
  activeNote.value = target;
  setSaveState("saved");

  if (inserted) {
    nextTick(() => {
      setupQuickSetters();
      const tab = findTab(target!.id);
      if (tab) gsap.from(tab, { x: 60 * -inward(), autoAlpha: 0, scale: .8, duration: isReducedMotion() ? 0 : .48, ease: "back.out(1.4)" });
    });
  }
  return target;
}

function editNote() {
  if (!activeNote.value) return;
  draftTarget.value = activeNote.value;
  draftTitle.value = activeNote.value.title;
  draftBody.value = activeNote.value.body;
  draftColor.value = activeNote.value.color;
  isNewNote.value = false;
  setSaveState("idle");
  mode.value = "edit";
  nextTick(() => {
    setEditorBodyValue(draftBody.value);
    focusEditorLine(editorBody.value?.querySelector<HTMLElement>(".editor-line") ?? null, 0);
  });
}

async function createNote() {
  if (mode.value === "edit" && isNewNote.value) {
    await closePreview();
    return;
  }
  const wasClosed = mode.value === "closed";
  if (mode.value === "edit") flushSave();
  activeNote.value = null;
  draftTarget.value = null;
  isNewNote.value = true;
  draftTitle.value = "";
  draftBody.value = "";
  draftColor.value = palette[Math.floor(Math.random() * palette.length)];
  setSaveState("idle");
  panelPending.value = wasClosed;
  if (wasClosed) await resizeForPanel(true);
  mode.value = "edit";
  await nextTick();
  setEditorBodyValue("");
  root.value?.querySelector<HTMLInputElement>(".editor-title")?.focus();
  const panel = root.value?.querySelector<HTMLElement>(".note-panel");
  if (panel && wasClosed) playPanelEntrance(panel);
}

async function finishEditing() {
  const saved = flushSave();
  if (!saved) {
    mode.value = "closed";
    await resizeForPanel(false);
    return;
  }
  activeNote.value = saved;
  draftTarget.value = null;
  isNewNote.value = false;
  mode.value = "preview";
  await nextTick();
  const panel = root.value?.querySelector(".note-panel");
  if (panel) gsap.fromTo(panel, { autoAlpha: .7, scale: .96 }, { autoAlpha: 1, scale: 1, duration: isReducedMotion() ? 0 : .24, ease: "power2.out" });
}

function closePanel() {
  return closePreview();
}

function onRootPointerDown(event: PointerEvent) {
  if (mode.value === "closed") return;
  const target = event.target as HTMLElement;
  if (target.closest(".note-panel")) return;
  // Tabs and Add own their panel-state transitions. Every other point in the
  // expanded transparent window (including the rail background/settings)
  // dismisses the panel.
  if (target.closest(".note-tab") || target.closest('[data-control="add"]')) return;
  void closePreview();
}

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
    checkbox.setAttribute("aria-label", checked ? "标记为未完成" : "标记为完成");
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
      // Bold inserts **** and places the caret between the middle stars;
      // italic/code follow the same "type inside the markers" interaction.
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
      // Enter on an empty list item exits list mode, matching checklist rows.
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
    checkbox.setAttribute("aria-label", checked ? "标记为未完成" : "标记为完成");
    scheduleSave();
    return;
  }

  const lines = [...(editorBody.value?.querySelectorAll<HTMLElement>(":scope > .editor-line") ?? [])];
  const clickedLine = target.closest<HTMLElement>(".editor-line");
  if (clickedLine) {
    // Keep the browser's native character-accurate caret for non-empty text.
    // Empty checklist/normal rows need an explicit editable insertion point.
    if ((clickedLine.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").length) return;
    focusEditorLine(clickedLine, 0);
    return;
  }

  // Clicking below the document follows the usual editor convention: place
  // the caret at the end of the final line (or at zero when it is empty).
  const destination = lines.at(-1) ?? null;
  const offset = (destination?.querySelector<HTMLElement>(".editor-line-copy")?.innerText || "").replace(/\n+$/g, "").length;
  focusEditorLine(destination, offset);
}

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

function toggleTask(index: number) {
  if (!activeNote.value) return;
  const lines = activeNote.value.body.split("\n");
  if (/^\s*☐/.test(lines[index])) lines[index] = lines[index].replace("☐", "☑");
  else if (/^\s*☑/.test(lines[index])) lines[index] = lines[index].replace("☑", "☐");
  else if (/^\s*-\s*\[\s\]/.test(lines[index])) lines[index] = lines[index].replace(/\[\s\]/, "[x]");
  else lines[index] = lines[index].replace(/\[[xX]\]/, "[ ]");
  activeNote.value.body = lines.join("\n");
}

function archiveNote(note: Note) {
  notes.value = notes.value.filter((item) => item.id !== note.id);
  quickSetters.delete(findTab(note.id) as HTMLElement);
  if (activeNote.value?.id === note.id) void closePreview();
  showToast(`“${note.title}”已归档`);
}

function deleteNote(note: Note) {
  notes.value = notes.value.filter((item) => item.id !== note.id);
  quickSetters.delete(findTab(note.id) as HTMLElement);
  if (activeNote.value?.id === note.id) void closePreview();
  showToast(`“${note.title}”已移到废纸篓`);
}

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
    await resizeForPanel(mode.value !== "closed");
  } catch {
    // Keep the current position if a window manager rejects repositioning.
  }
}

async function beginWindowDrag(event: PointerEvent) {
  if (event.button !== 0 || dragging.value || switchingPanel) return;
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
  if (mode.value !== "closed") await closePreview();
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
  nextTick(() => {
    showControls();
    void sampleControlContrast();
  });
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
    await resizeForPanel(mode.value !== "closed");
    showToast(nextSide === "left" ? "便签栏已吸附到左侧" : "便签栏已吸附到右侧");
    void sampleControlContrast();
  } catch {
    showToast("无法移动便签栏，请检查窗口权限");
  }
}

async function sampleControlContrast() {
  if (!root.value || dragging.value) return;
  try {
    const win = await getDockWindow();
    if (!win) return;
    const [{ invoke }, position, scaleFactor] = await Promise.all([
      import("@tauri-apps/api/core"), win.outerPosition(), win.scaleFactor(),
    ]);
    const names = ["handle", "add", "settings"] as const;
    const points = names.map((name) => {
      const element = root.value?.querySelector<HTMLElement>(`[data-control="${name}"]`);
      const rect = element?.getBoundingClientRect();
      if (!rect) return { x: position.x, y: position.y };
      const localX = side.value === "right" ? rect.left - 8 : rect.right + 8;
      return { x: Math.round(position.x + localX * scaleFactor), y: Math.round(position.y + (rect.top + rect.height / 2) * scaleFactor) };
    });
    const luminances = await invoke<Array<number | null>>("sample_screen_luminance", { points });
    const next = { ...controlTones.value };
    names.forEach((name, index) => {
      const luminance = luminances[index];
      if (luminance == null) return;
      if (luminance > .58) next[name] = "dark";
      else if (luminance < .45) next[name] = "light";
    });
    controlTones.value = next;
  } catch {
    // Keep the high-contrast light fallback when native sampling is unavailable.
  }
}

async function openSettings() {
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
  if (mode.value === "edit" && event.ctrlKey && event.key === "Enter") {
    event.preventDefault();
    flushSave();
  }
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
  const dockWindow = await getDockWindow();
  if (dockWindow) {
    unlistenDockFocus = await dockWindow.onFocusChanged(({ payload: focused }) => {
      // Pointer events cover transparent space inside the expanded host; the
      // native focus event also covers clicks elsewhere on the desktop.
      if (!focused && mode.value !== "closed" && !dragging.value) void closePreview();
    });
    await resizeForPanel(false);
    await dockWindow.show();
  }
  window.setTimeout(() => void sampleControlContrast(), 500);
  contrastTimer = window.setInterval(() => void sampleControlContrast(), 1500);
});

onUnmounted(() => {
  document.documentElement.classList.remove("dock-document");
  document.body.classList.remove("dock-document");
  window.clearTimeout(saveTimer);
  window.clearTimeout(saveStateTimer);
  window.clearTimeout(toastTimer);
  window.clearTimeout(controlsHideTimer);
  window.clearInterval(contrastTimer);
  hoverTimers.forEach((timer) => window.clearTimeout(timer));
  noteListObserver?.disconnect();
  unlistenDockFocus?.();
  panelAnimation?.kill();
  controlsTimeline?.kill();
  if (root.value) gsap.killTweensOf(root.value.querySelectorAll("*"));
  media?.revert();
  context?.revert();
});
</script>

<template>
  <main ref="root" class="dock-window" :class="[`dock-${side}`, { dragging, 'screen-compact': compact }]" :style="{ '--screen-height': `${screenHeight}px` }" @keydown="onRootKeydown" @pointerdown="onRootPointerDown">
    <button v-if="mode !== 'closed'" class="panel-dismiss-layer" type="button" aria-label="关闭便签" @pointerdown.stop="closePreview"></button>
    <article v-if="mode !== 'closed'" class="note-panel" :class="[mode, { 'panel-pending': panelPending }]" :style="{ '--paper': mode === 'edit' ? draftColor : activeNote?.color }">
        <template v-if="mode === 'preview' && activeNote">
          <header class="panel-header">
            <h1>{{ activeNote.title }}</h1>
            <div class="panel-actions">
              <button type="button" aria-label="编辑便签" title="编辑" @click="editNote"><svg viewBox="0 0 24 24"><path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4Z"/></svg></button>
              <!-- <button type="button" aria-label="关闭" @click="closePreview"><svg viewBox="0 0 24 24"><path d="m7 7 10 10M17 7 7 17"/></svg></button> -->
            </div>
          </header>
          <div class="preview-body">
            <template v-for="line in previewLines" :key="line.index">
              <component :is="`h${line.level}`" v-if="line.kind === 'heading'" v-html="line.html" />
              <div v-else-if="line.kind === 'task'" class="preview-task" :class="{ done: line.checked }"><button type="button" :aria-label="line.checked ? '标记未完成' : '标记完成'" @click="toggleTask(line.index)">{{ line.checked ? "✓" : "" }}</button><span v-html="line.html"></span></div>
              <div v-else-if="line.kind === 'list'" class="preview-list"><i></i><span v-html="line.html"></span></div>
              <blockquote v-else-if="line.kind === 'quote'" v-html="line.html" />
              <p v-else v-html="line.html || '&nbsp;'" />
            </template>
          </div>
        </template>
        <template v-else>
          <header class="editor-header">
            <div><b>{{ isNewNote ? "新便签" : "编辑便签" }}</b><span class="save-state" :class="saveState"><i></i>{{ saveState === "saving" ? "自动保存中…" : saveState === "saved" ? "已自动保存" : "自动保存" }}</span></div>
            <div v-if="isNewNote" class="palette"><button v-for="color in palette" :key="color" type="button" :class="{ selected: draftColor === color }" :style="{ background: color }" :aria-label="`选择颜色 ${color}`" @click="draftColor = color; scheduleSave()"></button></div>
          </header>
          <input v-model="draftTitle" class="editor-title" maxlength="28" placeholder="标题" @input="scheduleSave" @keydown.enter.prevent="focusBodyFromTitle">
          <div class="editor-body-shell">
            <div ref="editorBody" class="editor-body is-empty" role="textbox" aria-multiline="true" aria-label="便签内容，支持 Markdown" data-placeholder="随便写点什么。。。" @input="scheduleSave" @keydown="onEditorKeydown" @paste="onEditorPaste" @pointerdown="onEditorPointerDown" @click="onEditorClick"></div>
          </div>
          <footer class="format-bar" @pointerdown.prevent>
            <button type="button" title="插入任务" @click="insertTask"><svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="4"/><path d="m7.5 12 3 3 6-7"/></svg></button><i></i>
            <button type="button" title="标题" @click="applyMarkdown('heading')">H</button>
            <button type="button" title="粗体（在星号中输入）" @click="applyMarkdown('bold')"><b>B</b></button>
            <button type="button" title="斜体（选中文字，或点击后直接输入）" @click="applyMarkdown('italic')"><em>I</em></button>
            <button type="button" title="切换列表" @click="applyMarkdown('list')"><svg viewBox="0 0 24 24"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01"/></svg></button>
            <button type="button" title="行内代码（选中文字，或点击后直接输入）" @click="applyMarkdown('code')">&lt;/&gt;</button>
          </footer>
        </template>
    </article>

    <aside class="dock-rail" :class="{ 'controls-visible': controlsVisible }" aria-label="便签栏" @pointermove="onRailMove" @pointerleave="onRailLeave">
      <div class="grab-zone">
        <button class="drag-handle adaptive-control" data-control="handle" :data-tone="controlTones.handle" type="button" draggable="false" aria-label="拖动便签栏" :aria-pressed="dragging ? 'true' : 'false'" title="拖动便签栏" @pointerdown.left="beginWindowDrag" @keydown.enter.prevent="toggleSideWithKeyboard" @keydown.space.prevent="toggleSideWithKeyboard"><span><i></i><i></i><i></i><i></i><i></i><i></i></span></button>
      </div>
      <div class="note-list-shell" :class="{ 'blur-top': canScrollUp, 'blur-bottom': canScrollDown }">
        <div ref="noteList" class="note-list" @scroll="updateScrollEdges" @pointerenter="showControls">
        <div v-for="note in notes" :key="note.id" class="note-tab" :class="{ active: activeNote?.id === note.id, actions: actionNote === note.id }" :data-id="note.id" role="button" tabindex="0" draggable="false" :aria-label="`打开${note.title}`" @pointerenter="beginHover(note)" @pointerleave="endHover(note)" @click="openPreview(note)" @keydown.enter.prevent="openPreview(note)" @keydown.space.prevent="openPreview(note)">
          <span class="paper" :style="{ '--paper': note.color }"><span class="title">{{ displayTitle(note.title) }}</span><span class="quick-actions"><button type="button" title="归档" aria-label="归档" @click.stop="archiveNote(note)"><svg viewBox="0 0 24 24"><path d="M4 7h16v13H4zM3 4h18v3H3zM9 11h6"/></svg></button><button type="button" title="删除" aria-label="删除" @click.stop="deleteNote(note)"><svg viewBox="0 0 24 24"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5"/></svg></button></span></span>
        </div>
        </div>
      </div>
      <div class="rail-controls"><span class="separator"></span>
        <button class="adaptive-control" data-control="add" :data-tone="controlTones.add" type="button" aria-label="新建便签" @click="createNote"><svg viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg></button>
        <button class="adaptive-control" data-control="settings" :data-tone="controlTones.settings" type="button" aria-label="打开设置" @click="openSettings"><svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4.6a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.17.38.38.73.6 1 .28.34.67.54 1.1.6H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z"/></svg></button>
      </div>
    </aside>

    <Transition name="toast"><div v-if="toast" class="dock-toast" role="status">{{ toast }}</div></Transition>
  </main>
</template>

<style scoped>
.dock-window{--rail:104px;--ease:cubic-bezier(.22,1,.36,1);width:100vw;height:100vh;position:relative;overflow:hidden;color:#29262b;background:transparent;pointer-events:none;user-select:none;-webkit-user-select:none}.dock-window svg,.note-tab,.paper{-webkit-user-drag:none}.note-tab,.note-panel,.note-panel *,.drag-handle,.rail-controls>button{pointer-events:auto}.dock-rail{position:absolute;z-index:5;top:50%;right:0;width:var(--rail);height:min(calc(var(--screen-height) - 16px),calc(100vh - 16px));padding:3px 0;display:flex;flex-direction:column;align-items:flex-end;transform:translateY(-50%);perspective:700px;pointer-events:none}.dock-left .dock-rail{left:0;right:auto;align-items:flex-start}
.grab-zone{width:100%;height:38px;flex:0 0 38px;display:flex;align-items:center;justify-content:flex-end;opacity:0;visibility:hidden;transform:translateY(20px);pointer-events:none}.dock-left .grab-zone{justify-content:flex-start}.controls-visible .grab-zone,.dragging .grab-zone{pointer-events:none}.drag-handle{width:48px;height:32px;margin-right:8px;padding:0;display:grid;place-items:center;border:1px solid rgba(255,255,255,.2);border-radius:11px;color:rgba(255,255,255,.72);background:rgba(245,246,250,.2);box-shadow:none;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);cursor:grab;touch-action:none}.dock-left .drag-handle{margin:0 0 0 8px}.drag-handle>span{width:16px;display:grid;grid-template-columns:repeat(2,4px);grid-template-rows:repeat(3,4px);justify-content:space-between;gap:3px 0}.drag-handle i{width:4px;height:4px;border-radius:50%;background:currentColor}.drag-handle:hover{color:rgba(255,255,255,.96);background:rgba(245,246,250,.28)}.drag-handle:active,.dragging .drag-handle{cursor:grabbing}
.note-list-shell{position:relative;width:100%;min-height:0;max-height:min(calc(var(--screen-height) - 228px),calc(100vh - 156px));flex:1 1 auto;overflow:hidden;pointer-events:none}.note-list-shell::before,.note-list-shell::after{content:"";position:absolute;z-index:20;left:0;right:0;height:24px;opacity:0;pointer-events:none;transition:opacity .18s ease;backdrop-filter:blur(6px);-webkit-backdrop-filter:blur(6px)}.note-list-shell::before{top:0;mask-image:linear-gradient(to bottom,#000,transparent);-webkit-mask-image:linear-gradient(to bottom,#000,transparent)}.note-list-shell::after{bottom:0;mask-image:linear-gradient(to top,#000,transparent);-webkit-mask-image:linear-gradient(to top,#000,transparent)}.note-list-shell.blur-top::before,.note-list-shell.blur-bottom::after{opacity:1}.note-list{width:100%;height:100%;max-height:none;padding:10px 0 15px;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end;gap:2px;overflow-y:auto;overflow-x:hidden;overscroll-behavior:contain;scroll-behavior:smooth;scrollbar-width:none}.blur-top:not(.blur-bottom) .note-list{mask-image:linear-gradient(to bottom,transparent 0,#000 22px);-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 22px)}.blur-bottom:not(.blur-top) .note-list{mask-image:linear-gradient(to bottom,#000 calc(100% - 22px),transparent 100%);-webkit-mask-image:linear-gradient(to bottom,#000 calc(100% - 22px),transparent 100%)}.blur-top.blur-bottom .note-list{mask-image:linear-gradient(to bottom,transparent 0,#000 22px,#000 calc(100% - 22px),transparent 100%);-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 22px,#000 calc(100% - 22px),transparent 100%)}.note-list::-webkit-scrollbar{display:none}.dock-left .note-list{align-items:flex-start}.note-tab{position:relative;width:96px;height:114px;flex:0 0 114px;margin:0 -54px 0 0;padding:0;border:0;color:#302c2e;background:transparent;cursor:pointer;transform-origin:right center;will-change:transform;rotate:var(--tilt,0deg)}.note-tab+.note-tab{margin-top:-9px}.dock-left .note-tab{margin-right:0;margin-left:-54px;transform-origin:left center}.note-tab:nth-child(1){--tilt:-1.8deg;z-index:1}.note-tab:nth-child(2){--tilt:.9deg;z-index:2}.note-tab:nth-child(3){--tilt:-1.1deg;z-index:3}.note-tab:nth-child(4){--tilt:1.25deg;z-index:4}.note-tab:nth-child(5){--tilt:-1.35deg;z-index:5}.note-tab:nth-child(n+6){--tilt:-1deg}.note-tab.nearest,.note-tab.active,.note-tab:hover{z-index:12}.paper{position:absolute;inset:0;overflow:hidden;display:block;border-radius:18px 0 0 18px;background:var(--paper);box-shadow:none;transition:filter .2s ease}.note-tab:hover .paper{filter:brightness(1.045);box-shadow:none}.dock-left .paper{border-radius:0 18px 18px 0;box-shadow:none}.paper::after{content:"";position:absolute;inset:0;background:linear-gradient(145deg,rgba(255,255,255,.3),transparent 40%,rgba(60,45,30,.05));pointer-events:none}.paper::before{content:"";position:absolute;z-index:2;top:9px;bottom:9px;right:50%;border-right:1px dashed rgba(72,58,43,.2)}.title{position:absolute;z-index:3;left:0;top:9px;bottom:9px;width:38px;display:grid;place-items:center;writing-mode:vertical-rl;text-orientation:upright;color:rgba(47,42,40,.78);font-size:14px;font-weight:800;letter-spacing:.08em;overflow:hidden;text-overflow:ellipsis}.dock-left .title{left:auto;right:0}
.quick-actions{position:absolute;z-index:4;right:7px;top:0;bottom:0;width:45px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;opacity:0;transform:translateX(7px) scale(.92);pointer-events:none;transition:opacity .16s ease,transform .22s var(--ease)}.dock-left .quick-actions{left:7px;right:auto;transform:translateX(-7px) scale(.92)}.note-tab.actions .quick-actions{opacity:1;transform:none;pointer-events:auto}.quick-actions button{width:31px;height:31px;padding:0;display:grid;place-items:center;border:0;border-radius:10px;color:rgba(52,45,44,.63);background:transparent;cursor:pointer;transition:color .18s ease,background .18s ease,transform .2s var(--ease)}.quick-actions svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.quick-actions button:hover{color:#fff;transform:scale(1.06)}.quick-actions button:hover:first-child{background:#5b92e8;box-shadow:none}.quick-actions button:hover:last-child{background:#ef6262;box-shadow:none}
.rail-controls{position:relative;z-index:30;width:100%;padding-top:0;display:flex;flex:0 0 auto;flex-direction:column;align-items:flex-end;opacity:0;visibility:hidden;transform:translateX(18px);pointer-events:none}.dock-left .rail-controls{align-items:flex-start;transform:translateX(-18px)}.controls-visible:not(.dragging) .rail-controls{pointer-events:none}.rail-controls .separator{position:absolute;top:-8px;right:0;width:54px;height:1px;margin:0;background:rgba(255,255,255,.18)}.dock-left .rail-controls .separator{right:auto;left:0}.rail-controls>button{position:relative;width:48px;height:48px;margin:0 4px 6px 0;padding:0;display:grid;place-items:center;border:1px solid rgba(255,255,255,.2);border-radius:50%;color:rgba(255,255,255,.9);background:rgba(28,30,35,.72);box-shadow:none;backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px);cursor:pointer}.dock-left .rail-controls>button{margin-right:0;margin-left:4px}.rail-controls>button>svg{width:22px;height:22px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round;transition:transform .2s var(--ease)}.rail-controls>button:hover{color:#fff;background:rgba(18,20,24,.84)}.rail-controls>button:hover>svg{transform:scale(1.16)}.rail-controls>button:active>svg{transform:scale(.94)}
.panel-dismiss-layer{position:absolute;z-index:2;inset:0;padding:0;border:0;background:transparent;pointer-events:auto;cursor:default}.adaptive-control[data-tone="dark"]{color:rgba(255,255,255,.9)!important;border-color:rgba(255,255,255,.2)!important;background:rgba(28,30,35,.72)!important;box-shadow:none}.adaptive-control[data-tone="dark"]:hover{color:#fff!important;background:rgba(18,20,24,.84)!important}
.note-panel{position:absolute;z-index:3;top:50%;right:94px;width:min(380px,calc(100vw - 117px));overflow:hidden;will-change:transform,opacity;border:1px solid rgba(255,255,255,.28);border-radius:20px;color:#2c2930;background:var(--paper,#ffe78a);box-shadow:none;transform:translateY(-50%);transform-origin:right center;pointer-events:none;user-select:none;-webkit-user-select:none}.note-panel.panel-pending{visibility:hidden;opacity:0}.note-panel.preview{height:min(490px,72vh)}.note-panel.edit{height:min(560px,78vh)}.dock-left .note-panel{left:94px;right:auto;transform-origin:left center}.note-panel::before{content:"";position:absolute;inset:0;pointer-events:none;background:linear-gradient(145deg,rgba(255,255,255,.26),transparent 26%,rgba(107,73,25,.05))}.panel-header{position:relative;z-index:1;height:64px;padding:0 15px 0 19px;display:flex;align-items:center;justify-content:space-between;border-bottom:1px solid rgba(70,55,30,.11)}.panel-header h1{min-width:0;margin:0;overflow:hidden;color:#29262b;font-size:22px;line-height:1.2;letter-spacing:-.025em;text-overflow:ellipsis;white-space:nowrap}.panel-actions{display:flex;gap:6px}.panel-actions button,.panel-close{width:30px;height:30px;padding:0;display:grid;place-items:center;border:0;border-radius:50%;color:rgba(40,35,31,.58);background:rgba(255,255,255,.22);cursor:pointer;transition:background .18s ease,transform .18s ease}.panel-actions button:hover,.panel-close:hover{background:rgba(255,255,255,.42);transform:scale(1.06)}.panel-actions svg,.panel-close svg{width:17px;height:17px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.preview-body{position:relative;z-index:1;height:calc(100% - 64px);padding:18px 22px 30px;overflow-y:auto;user-select:none;-webkit-user-select:none;font-size:17px;line-height:1.85;scrollbar-width:thin;scrollbar-color:rgba(70,55,30,.22) transparent}.preview-body p{min-height:1.7em;margin:2px 0}.preview-body h1,.preview-body h2,.preview-body h3{margin:19px 0 8px;line-height:1.3}.preview-body h1{font-size:23px}.preview-body h2{font-size:20px}.preview-body h3{font-size:17px}.preview-body :deep(code){padding:2px 5px;border-radius:5px;background:rgba(255,255,255,.28);font-family:"Cascadia Code",Consolas,monospace;font-size:.9em}.preview-body :deep(a){color:#315f9f;text-decoration-thickness:1px;text-underline-offset:2px}.preview-body blockquote{margin:8px 0;padding-left:12px;border-left:3px solid rgba(54,48,53,.3);color:rgba(54,48,53,.72)}.preview-task,.preview-list{display:flex;align-items:flex-start;gap:9px;margin:5px 0}.preview-task button{width:19px;height:19px;flex:0 0 auto;margin-top:6px;padding:0;display:grid;place-items:center;border:1.6px solid rgba(54,48,53,.48);border-radius:6px;color:#fff;background:rgba(255,255,255,.2);cursor:pointer;font-size:13px}.preview-task.done button{border-color:#3d985c;background:#4cab69}.preview-task.done span{opacity:.55;text-decoration:line-through}.preview-list i{width:5px;height:5px;flex:0 0 auto;margin:10px 5px 0 6px;border-radius:50%;background:currentColor;opacity:.58}
.editor-header{position:relative;z-index:1;height:56px;padding:0 14px 0 19px;display:flex;align-items:center;justify-content:space-between;gap:12px;border-bottom:1px solid rgba(70,55,30,.11)}.editor-header>div:first-child{display:flex;align-items:center;gap:9px;white-space:nowrap}.editor-header b{font-size:13px}.save-state{display:inline-flex;align-items:center;gap:6px;color:rgba(45,39,34,.58);font-size:11px;font-weight:650;transition:opacity .18s ease}.save-state.idle,.save-state.typing{opacity:0}.save-state i{width:6px;height:6px;border-radius:50%;background:rgba(45,39,34,.28)}.save-state.saving i{background:#4e7fc9;animation:pulse .7s ease-in-out infinite alternate}.save-state.saved i{background:#3e9b5d}.palette{margin-left:auto;display:flex;gap:7px}.palette button{width:18px;height:18px;padding:0;border:2px solid rgba(255,255,255,.62);border-radius:50%;box-shadow:none;cursor:pointer;transition:transform .16s ease}.palette button:hover{transform:scale(1.16)}.palette button.selected{border-color:rgba(43,38,35,.7);transform:scale(.88)}.editor-title{position:relative;z-index:1;width:100%;height:78px;padding:20px 22px 10px;border:0;outline:0;color:#29262b;background:transparent;font-size:27px;font-weight:700;line-height:1.2;letter-spacing:-.035em}.editor-title::placeholder{color:rgba(45,39,34,.4)}.editor-body-shell{position:relative;z-index:1;height:calc(100% - 188px);min-height:0}.editor-title,.editor-body{user-select:text;-webkit-user-select:text}.editor-body{position:absolute;inset:0;padding:10px 22px 20px;overflow-y:auto;outline:0;font-size:17px;line-height:1.85;scrollbar-width:thin;scrollbar-color:rgba(70,55,30,.28) transparent}.editor-body.is-empty::before{content:attr(data-placeholder);position:absolute;left:22px;top:10px;color:rgba(45,39,34,.4);pointer-events:none}.editor-body :deep(.editor-line){min-height:31.45px;display:block;overflow-wrap:anywhere;white-space:pre-wrap}.editor-body :deep(.editor-line.is-task){display:grid;grid-template-columns:19px minmax(0,1fr);align-items:start;gap:9px}.editor-body :deep(.editor-line-copy){min-width:0;outline:0;overflow-wrap:anywhere;white-space:pre-wrap}.editor-body :deep(.editor-task-box){width:19px;height:19px;margin-top:6px;padding:0;display:grid;place-items:center;border:1.6px solid rgba(54,48,53,.5);border-radius:6px;color:#fff;background:transparent;cursor:pointer}.editor-body :deep(.editor-task-box.is-checked){border-color:#3d985c;background:#4cab69}.editor-body :deep(.editor-task-box.is-checked::after){content:"✓";font-size:13px;font-weight:800;line-height:1}.format-bar{position:absolute;z-index:2;left:0;right:0;bottom:0;height:54px;padding:0 18px;display:flex;align-items:center;gap:5px;border-top:1px solid rgba(70,55,30,.1);background:rgba(255,255,255,.12)}.format-bar button{width:32px;height:32px;padding:0;display:grid;place-items:center;border:0;border-radius:8px;color:rgba(43,38,42,.66);background:transparent;cursor:pointer;font-weight:750}.format-bar button:hover{color:#29242a;background:rgba(255,255,255,.36)}.format-bar svg{width:16px;height:16px;fill:none;stroke:currentColor;stroke-width:1.8;stroke-linecap:round;stroke-linejoin:round}.format-bar>i{width:1px;height:20px;margin:0 3px;background:rgba(70,55,30,.13)}.format-bar>span{margin-left:auto;color:rgba(45,39,34,.5);font-size:10px;white-space:nowrap}
.dragging .dock-rail{z-index:50}.dragging .note-list{mask-image:none;-webkit-mask-image:none;align-items:flex-end}.dock-left.dragging .note-list{align-items:flex-end}.dragging .note-tab{width:96px;height:96px;flex-basis:96px;margin:-4px 0 0!important;transform-origin:center}.dragging .paper{border-radius:16px!important;animation:wiggle .22s ease-in-out infinite alternate}.dragging .note-tab:nth-child(2n) .paper{animation-delay:-.11s}.dragging .note-tab:nth-child(3n) .paper{animation-delay:-.055s}.dragging .title{inset:0;width:auto;writing-mode:horizontal-tb;text-orientation:mixed;letter-spacing:.04em}.dragging .paper::before,.dragging .quick-actions,.dragging .rail-controls{display:none}.screen-compact .note-list-shell{max-height:min(calc(var(--screen-height) - 224px),calc(100vh - 170px))}.screen-compact .note-list{gap:1px}.screen-compact .note-tab{height:88px;flex-basis:88px}.screen-compact .note-tab+.note-tab{margin-top:-7px}.screen-compact .paper{border-radius:15px 0 0 15px}.screen-compact.dock-left .paper{border-radius:0 15px 15px 0}.screen-compact .title{font-size:12px;letter-spacing:.02em}.screen-compact.dragging .note-tab{width:88px;height:88px;flex-basis:88px}.screen-compact.dragging .paper{border-radius:15px!important}
.dock-toast{position:absolute;z-index:60;left:50%;bottom:16px;padding:9px 13px;border:1px solid rgba(255,255,255,.13);border-radius:10px;color:#fff;background:rgba(28,26,32,.86);box-shadow:none;transform:translateX(-50%);font-size:10px;white-space:nowrap}.toast-enter-active,.toast-leave-active{transition:opacity .16s ease,transform .2s ease}.toast-enter-from,.toast-leave-to{opacity:0;transform:translate(-50%,7px)}.panel-fade-leave-active{transition:opacity .15s ease}.panel-fade-leave-to{opacity:0}@keyframes wiggle{from{transform:rotate(-2deg) translate3d(-1px,0,0)}to{transform:rotate(2deg) translate3d(1px,-1px,0)}}@keyframes pulse{to{opacity:.35;transform:scale(.72)}}
@media(max-width:500px){.palette{gap:4px}.palette button{width:14px;height:14px}.format-bar>span{display:none}}@media(prefers-reduced-motion:reduce){.dragging .paper{animation:none!important}*{scroll-behavior:auto!important}}
</style>
