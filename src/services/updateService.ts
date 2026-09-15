import { ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import type { Update } from "@tauri-apps/plugin-updater";

export type UpdateProgress = {
  downloaded: number;
  total: number;
};

/** Version announced by the background checker or by a manual check; null means "up to date". */
export const availableVersion = ref<string | null>(null);

/** A tray request is retained until the Settings view is ready to handle it. */
export const manualUpdateCheckRequested = ref(false);

export function requestManualUpdateCheck(): void {
  manualUpdateCheckRequested.value = true;
}

export function takeManualUpdateCheckRequest(): boolean {
  if (!manualUpdateCheckRequested.value) return false;
  manualUpdateCheckRequested.value = false;
  return true;
}

/**
 * Check for an update. Resolves to null when the app is up to date, or when
 * running outside the desktop shell (browser preview).
 */
export async function checkForUpdate(): Promise<Update | null> {
  if (!isTauri()) return null;
  const { check } = await import("@tauri-apps/plugin-updater");
  const update = await check({ timeout: 30_000 });
  availableVersion.value = update ? update.version : null;
  return update;
}

/**
 * Download and install the update, then relaunch.
 *
 * On Windows the NSIS installer takes over and exits the app, so the relaunch
 * below is only a safety net for platforms that keep the process alive.
 */
export async function downloadInstallAndRelaunch(
  update: Update,
  onProgress?: (progress: UpdateProgress) => void,
): Promise<void> {
  let downloaded = 0;
  let total = 0;
  await update.downloadAndInstall((event) => {
    switch (event.event) {
      case "Started":
        total = event.data.contentLength ?? 0;
        onProgress?.({ downloaded, total });
        break;
      case "Progress":
        downloaded += event.data.chunkLength;
        onProgress?.({ downloaded, total });
        break;
      case "Finished":
        onProgress?.({ downloaded: total, total });
        break;
    }
  });
  const { relaunch } = await import("@tauri-apps/plugin-process");
  await relaunch();
}

/**
 * Listen for the Rust-side background checker. Only the main window should call
 * this, and callers must dispose the returned function on unmount.
 */
export async function listenForUpdateAnnouncements(
  handler: (version: string) => void,
): Promise<() => void> {
  if (!isTauri()) return () => {};
  const { listen } = await import("@tauri-apps/api/event");
  return await listen<string>("update:available", (event) => {
    availableVersion.value = event.payload;
    handler(event.payload);
  });
}
