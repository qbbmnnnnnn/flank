import { ref } from "vue";

export const notification = ref("");
let timer: ReturnType<typeof setTimeout> | undefined;

export function dismissNotification() {
  clearTimeout(timer);
  notification.value = "";
}

export function receiveNotification(message: string) {
  clearTimeout(timer);
  notification.value = message;
  timer = setTimeout(dismissNotification, 4000);
}

/** Cross-window messages are rendered only by the main window. */
export function showNotification(message: string) {
  if (!("__TAURI_INTERNALS__" in window)) {
    receiveNotification(message);
    return;
  }
  void import("@tauri-apps/api/core")
    .then(({ invoke }) => invoke("show_main_notification", { message }))
    .catch((error) => console.error("Unable to deliver notification", error));
}
