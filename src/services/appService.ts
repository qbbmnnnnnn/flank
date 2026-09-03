import { invoke } from "@tauri-apps/api/core";

import type { AppInfo } from "../contracts/app";

export const appService = {
  getInfo: () => invoke<AppInfo>("get_app_info"),
};
