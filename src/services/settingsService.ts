import { readonly, ref } from "vue";
import { isTauri } from "@tauri-apps/api/core";
import type { AppSettings } from "../contracts/app";
import { defaultSettings, normalizeSettings } from "../contracts/settings";
import { appService } from "./appService";

export const SETTINGS_KEY = "flank-app-settings";
const current = ref<AppSettings>({ ...defaultSettings });
const loaded = ref(false);
const pending = ref(0);
const error = ref("");
let queue: Promise<unknown> = Promise.resolve();
let initializing: Promise<void> | undefined;
let dispose: (() => void) | undefined;
export const savedSettings = readonly(current);
export const settingsLoaded = readonly(loaded);
export const settingsPending = readonly(pending);
export const settingsError = readonly(error);

function accept(settings: Partial<AppSettings>) {
  current.value = normalizeSettings(settings);
}

export function initializeSettings(): Promise<void> {
  if (initializing) return initializing;
  initializing = (async () => {
    try {
      if (isTauri()) {
        const { listen } = await import("@tauri-apps/api/event");
        dispose?.();
        let received = 0;
        dispose = await listen<AppSettings>("settings-updated", ({ payload }) => { received++; accept(payload); });
        const snapshot = await appService.getSettings();
        if (!received) accept(snapshot);
      } else {
        const raw = localStorage.getItem(SETTINGS_KEY);
        accept(raw ? JSON.parse(raw) : defaultSettings);
        const sync = (event: StorageEvent) => {
          if (event.key !== SETTINGS_KEY) return;
          try { accept(event.newValue ? JSON.parse(event.newValue) : defaultSettings); } catch { /* Ignore malformed external writes. */ }
        };
        window.addEventListener("storage", sync);
        dispose = () => window.removeEventListener("storage", sync);
      }
      loaded.value = true;
      error.value = "";
    } catch {
      error.value = "设置读取失败，请重试";
    }
  })().finally(() => { if (!loaded.value) initializing = undefined; });
  return initializing;
}

/** Capture individual changed fields; never send a stale whole-window snapshot. */
export function saveSettingsPatch(patch: Partial<AppSettings>): Promise<AppSettings> {
  if (!loaded.value) return Promise.reject(new Error("Settings are not loaded"));
  const requested = { ...patch };
  pending.value++;
  const operation = queue.then(async () => {
    try {
      let result: AppSettings;
      if (isTauri()) result = await appService.updateSettings(requested);
      else {
        if ("launchAtLogin" in requested) throw new Error("Autostart requires the desktop app");
        const raw = localStorage.getItem(SETTINGS_KEY);
        result = normalizeSettings({ ...(raw ? JSON.parse(raw) : current.value), ...requested });
        localStorage.setItem(SETTINGS_KEY, JSON.stringify(result));
      }
      accept(result);
      error.value = "";
      return result;
    } catch (cause) {
      if (isTauri()) {
        try { accept(await appService.getSettings()); } catch { /* Retain the last confirmed state. */ }
      }
      error.value = "设置保存失败，已恢复为已保存的设置";
      throw cause;
    } finally {
      pending.value--;
    }
  });
  // A rejected save must not poison subsequent saves. The queue outlives SettingsView.
  queue = operation.catch(() => undefined);
  return operation;
}

export async function flushSettings(): Promise<boolean> {
  while (pending.value) await queue;
  // Failed writes have already rolled back and reported an error; they must not trap the window open.
  return true;
}

export function disposeSettings() {
  dispose?.();
  dispose = undefined;
  initializing = undefined;
}
