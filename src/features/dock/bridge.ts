// Lightweight cross-webview contract between the Dock rail and the Dock panel.
// Data currently lives in the rail's in-memory mock; the same events will later
// be backed by SQLite without changing either view's call sites.

export interface Note {
  id: string;
  title: string;
  body: string;
  color: string;
}

export type AnchorSide = "left" | "right";

export interface DockPanelOpenPayload {
  /** `null` when opening a brand-new note editor. */
  note: Note | null;
  anchorSide: AnchorSide;
  /** Start a new-note editor (rail's "add" action). */
  isNew: boolean;
  /** The note is already open; the panel should toggle preview/edit. */
  sameNote: boolean;
}

export interface DockPanelSavePayload {
  note: Note;
  /** True on the first save of a brand-new note. */
  isNew: boolean;
}

export const DOCK_BRIDGE = {
  open: "dock-panel:open",
  close: "dock-panel:close",
  save: "dock-panel:save",
  blurred: "dock-panel:blurred",
  requestClose: "dock-panel:request-close",
} as const;

export function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
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
