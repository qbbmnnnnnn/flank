import type { AppSettings } from "./app";

export const defaultSettings: AppSettings = {
  language: "zh-CN", theme: "system", launchAtLogin: false, closeBehavior: "background",
  dockEnabled: true, dockVisibleCount: 5, dockSide: "right", verticalPosition: 50,
  dockSize: "medium", hoverAnimation: true, actionDelay: 1, fullscreenBehavior: "hide",
  displayPreference: "cursor", font: "system", fontSize: 16, textDirection: "automatic",
  markdown: true, defaultColor: "random", automaticUpdates: true,
};

export function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings, ...value,
    language: ["zh-CN", "en-US"].includes(value.language ?? "") ? value.language! : "zh-CN",
    theme: ["system", "light", "dark"].includes(value.theme ?? "") ? value.theme! : "system",
    closeBehavior: value.closeBehavior === "quit" ? "quit" : "background",
  };
}
