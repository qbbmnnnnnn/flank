import { invoke } from "@tauri-apps/api/core";

import type { AppInfo, AppSettings } from "../contracts/app";

export const appService = {
  getInfo: () => invoke<AppInfo>("get_app_info"),
  getSettings: () => invoke<AppSettings>("get_settings"),
  saveSettings: (settings: AppSettings) => invoke<AppSettings>("save_settings", { settings }),
  updateSettings: (patch: Partial<AppSettings>) => invoke<AppSettings>("save_settings", { patch }),
  showMainWindow: (route?: "/") => invoke<void>("show_main_window", { route: route ?? null }),
  toggleDockWindow: () => invoke<boolean>("toggle_dock_window"),
};
