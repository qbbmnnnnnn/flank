// Lightweight cross-webview contract between the Dock rail and the Dock panel.
// Notes use the same persisted record shape as the main library.

import type { NoteRecord } from "../../contracts/note";

export type Note = NoteRecord;

// Built-in and user colors both resolve through the shared `--note-*` properties.
export { noteColorCss } from "../../services/noteColorService";

export type AnchorSide = "left" | "right";

export interface DockPanelOpenPayload {
  /** `null` when opening a brand-new note editor. */
  note: Note | null;
  anchorSide: AnchorSide;
  /** Start a new-note editor (rail's "add" action). */
  isNew: boolean;
  /** The note is already open; the panel should toggle preview/edit. */
  sameNote: boolean;
  /** A Dock-only usage guide that must never be persisted or edited. */
  isPlaceholder?: boolean;
  /** Current rail width in logical pixels so the panel can offset its paper to sit beside the rail. */
  dockRailWidth: number;
}

export interface DockPanelSavePayload {
  note: Note;
  /** True on the first save of a brand-new note. */
  isNew: boolean;
}

export interface DockRailResizePayload {
  railWidth: number;
}

export const DOCK_BRIDGE = {
  open: "dock-panel:open",
  close: "dock-panel:close",
  save: "dock-panel:save",
  blurred: "dock-panel:blurred",
  requestClose: "dock-panel:request-close",
  createNote: "dock:create-note",
  hidden: "dock:hidden",
  railResize: "dock:rail-resize",
  nativePointer: "dock:native-pointer",
} as const;

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

export function isMacOS(): boolean {
  return /Macintosh|Mac OS X/i.test(window.navigator.userAgent);
}

export async function emitToPanel<T>(event: string, payload: T): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("dock-panel", event, payload);
}

export async function emitToDock<T>(event: string, payload: T): Promise<void> {
  if (!isTauriRuntime()) return;
  const { emitTo } = await import("@tauri-apps/api/event");
  await emitTo("dock", event, payload);
}

export async function listenOnWebview<T>(
  event: string,
  handler: (payload: T) => void,
): Promise<(() => void) | undefined> {
  if (!isTauriRuntime()) return undefined;
  const { listen } = await import("@tauri-apps/api/event");
  return listen<T>(event, (eventPayload) => handler(eventPayload.payload));
}
