import { ref } from "vue";

/** Toast tones. Each one has its own light/dark treatment in App.vue. */
export type NotificationKind = "success" | "error" | "info";

export interface NotificationMessage {
  message: string;
  kind: NotificationKind;
  /** Increments per message so the countdown bar can restart. */
  id: number;
}

/** Kept in sync with the countdown bar animation in App.vue. */
export const NOTIFICATION_DURATION_MS = 4000;

export const notification = ref<NotificationMessage | null>(null);
let timer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;

export function dismissNotification() {
  clearTimeout(timer);
  notification.value = null;
}

export function receiveNotification(message: string, kind: NotificationKind = "info") {
  clearTimeout(timer);
  notification.value = { message, kind, id: ++sequence };
  timer = setTimeout(dismissNotification, NOTIFICATION_DURATION_MS);
}

/** Tauri rejects with a string, an Error, or the raw backend payload. */
export function failureReason(cause: unknown): string {
  if (typeof cause === "string") return cause;
  if (cause instanceof Error) return cause.message;
  try {
    const text = JSON.stringify(cause);
    return !text || text === "{}" ? "" : text;
  } catch {
    return "";
  }
}

/** Cross-window messages are rendered only by the main window. */
export function showNotification(message: string, kind: NotificationKind = "info") {
  if (!("__TAURI_INTERNALS__" in window)) {
    receiveNotification(message, kind);
    return;
  }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("show_main_notification", { message, kind }))
    .catch((error) => console.error("Unable to deliver notification", error));
}
