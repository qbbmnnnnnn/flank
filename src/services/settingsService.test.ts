import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultSettings } from "../contracts/settings";

const runtime = vi.hoisted(() => ({ desktop: false }));
const native = vi.hoisted(() => ({ getSettings: vi.fn(), updateSettings: vi.fn(), listen: vi.fn() }));
vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => runtime.desktop }));
vi.mock("./appService", () => ({ appService: native }));
vi.mock("@tauri-apps/api/event", () => ({ listen: native.listen }));
let service: typeof import("./settingsService");

beforeEach(async () => {
  vi.resetModules(); vi.clearAllMocks(); localStorage.clear(); runtime.desktop = false;
  native.listen.mockResolvedValue(() => undefined);
  service = await import("./settingsService");
});
afterEach(() => { service.disposeSettings(); vi.restoreAllMocks(); });

describe("persisted settings", () => {
  it("loads legacy settings without overwriting them and supplies the missing theme", async () => {
    const raw = JSON.stringify({ language: "en-US", closeBehavior: "quit" });
    localStorage.setItem(service.SETTINGS_KEY, raw);
    await service.initializeSettings();
    expect(service.savedSettings.value).toMatchObject({ language: "en-US", theme: "system", closeBehavior: "quit" });
    expect(localStorage.getItem(service.SETTINGS_KEY)).toBe(raw);
  });
  it("restores all saved general settings in a fresh runtime", async () => {
    await service.initializeSettings();
    await service.saveSettingsPatch({ language: "en-US", theme: "dark", closeBehavior: "quit" });
    service.disposeSettings(); vi.resetModules();
    service = await import("./settingsService");
    await service.initializeSettings();
    expect(service.savedSettings.value).toMatchObject({ language: "en-US", theme: "dark", closeBehavior: "quit" });
  });
  it("does not save until the authoritative settings are loaded", async () => {
    await expect(service.saveSettingsPatch({ theme: "dark" })).rejects.toThrow("not loaded");
    expect(localStorage.getItem(service.SETTINGS_KEY)).toBeNull();
  });
  it("serializes quick edits and flushes them even without a mounted settings view", async () => {
    await service.initializeSettings();
    const first = service.saveSettingsPatch({ theme: "dark" });
    const second = service.saveSettingsPatch({ language: "en-US" });
    const third = service.saveSettingsPatch({ theme: "light", closeBehavior: "quit" });
    expect(service.settingsPending.value).toBe(3);
    await service.flushSettings(); await Promise.all([first, second, third]);
    expect(JSON.parse(localStorage.getItem(service.SETTINGS_KEY)!)).toMatchObject({ theme: "light", language: "en-US", closeBehavior: "quit" });
    expect(service.settingsPending.value).toBe(0);
  });
  it("keeps confirmed values on write failure and permits recovery", async () => {
    await service.initializeSettings();
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("disk full"); });
    await expect(service.saveSettingsPatch({ theme: "dark" })).rejects.toThrow();
    expect(service.savedSettings.value.theme).toBe("system");
    expect(service.settingsError.value).not.toBe("");
    expect(await service.flushSettings()).toBe(true);
    spy.mockRestore();
    await service.saveSettingsPatch({ theme: "light" });
    expect(service.savedSettings.value.theme).toBe("light");
    expect(service.settingsError.value).toBe("");
  });
  it("supports retry after a read error instead of saving defaults", async () => {
    localStorage.setItem(service.SETTINGS_KEY, "invalid JSON");
    await service.initializeSettings();
    expect(service.settingsLoaded.value).toBe(false);
    localStorage.setItem(service.SETTINGS_KEY, JSON.stringify({ theme: "dark" }));
    await service.initializeSettings();
    expect(service.settingsLoaded.value).toBe(true);
    expect(service.savedSettings.value.theme).toBe("dark");
  });
  it("syncs other browser windows and rejects unsupported browser autostart", async () => {
    await service.initializeSettings();
    window.dispatchEvent(new StorageEvent("storage", { key: service.SETTINGS_KEY, newValue: JSON.stringify({ theme: "dark", language: "en-US" }) }));
    expect(service.savedSettings.value.theme).toBe("dark");
    await expect(service.saveSettingsPatch({ launchAtLogin: true })).rejects.toThrow("desktop");
    expect(service.savedSettings.value.launchAtLogin).toBe(false);
  });
  it("loads native persisted settings and rolls back a native save error", async () => {
    runtime.desktop = true;
    native.getSettings.mockResolvedValue({ ...defaultSettings, launchAtLogin: true, closeBehavior: "quit", language: "en-US" });
    await service.initializeSettings();
    expect(service.savedSettings.value.launchAtLogin).toBe(true);
    native.updateSettings.mockRejectedValue(new Error("registry denied"));
    await expect(service.saveSettingsPatch({ launchAtLogin: false })).rejects.toThrow();
    expect(service.savedSettings.value.launchAtLogin).toBe(true);
    expect(native.updateSettings).toHaveBeenCalledWith({ launchAtLogin: false });
  });
  it("does not overwrite a newer native event with a delayed startup snapshot", async () => {
    runtime.desktop = true;
    native.getSettings.mockImplementation(async () => {
      const callback = native.listen.mock.calls[0][1];
      callback({ payload: { ...defaultSettings, theme: "dark" } });
      return defaultSettings;
    });
    await service.initializeSettings();
    expect(service.savedSettings.value.theme).toBe("dark");
  });
});
