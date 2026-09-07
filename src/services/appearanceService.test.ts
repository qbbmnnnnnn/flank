import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { nextTick } from "vue";
import { defaultSettings } from "../contracts/settings";
import { normalizeSettings } from "../contracts/settings";
import { initializeSettings, saveSettingsPatch, disposeSettings, SETTINGS_KEY } from "./settingsService";
import { installAppearance } from "./appearanceService";
import { t } from "./i18n";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => false }));
let dark = false;
let change: () => void;
let stop: () => void;
beforeEach(async () => {
  dark = false;
  vi.stubGlobal("matchMedia", vi.fn(() => ({ get matches() { return dark; }, addEventListener: (_: string, listener: () => void) => { change = listener; }, removeEventListener: vi.fn() })));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(defaultSettings));
  await initializeSettings(); stop = installAppearance();
});
afterEach(() => { stop(); disposeSettings(); vi.unstubAllGlobals(); });
it("follows the system only when system is selected", async () => {
  expect(document.documentElement.dataset.theme).toBe("light");
  dark = true; change();
  expect(document.documentElement.dataset.theme).toBe("dark");
  await saveSettingsPatch({ theme: "light" }); await nextTick(); change();
  expect(document.documentElement.dataset.theme).toBe("light");
  await saveSettingsPatch({ theme: "dark" }); await nextTick(); dark = false; change();
  expect(document.documentElement.dataset.theme).toBe("dark");
});
it("changes document language and translated chrome, never interpolated user content", async () => {
  await saveSettingsPatch({ language: "en-US" }); await nextTick();
  expect(document.documentElement.lang).toBe("en-US");
  expect(t("通用设置")).toBe("General settings");
  expect(t("便签：{title}", { title: "今日灵感" })).toBe("Note: 今日灵感");
  await saveSettingsPatch({ language: "zh-CN" });
  expect(t("通用设置")).toBe("通用设置");
});
it("supports exactly Chinese and English with safe legacy fallbacks", () => {
  expect(normalizeSettings({ language: "ja-JP" }).language).toBe("zh-CN");
  expect(normalizeSettings({ language: "en-US" }).language).toBe("en-US");
});
