import { flushPromises, mount } from "@vue/test-utils";
import { createPinia } from "pinia";
import { describe, expect, it, vi } from "vitest";

import { router } from "../../app/router";
import { initializeSettings, savedSettings } from "../../services/settingsService";
import { installNoteColors } from "../../services/noteColorService";
import SettingsView from "./SettingsView.vue";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => false,
  invoke: () => Promise.reject(new Error("desktop only")),
}));

describe("SettingsView", () => {
  it("adds, renames and removes pool colors", async () => {
    await initializeSettings();
    installNoteColors();
    await router.push("/settings");
    await router.isReady();
    const wrapper = mount(SettingsView, { global: { plugins: [createPinia(), router] } });
    await flushPromises();
    const dockNav = wrapper.findAll(".nav-item").find((item) => item.text().includes("便签栏"))!;
    await dockNav.trigger("click");
    await flushPromises();
    expect(wrapper.findAll(".pool-item")).toHaveLength(7);

    const picker = wrapper.find(".pool-item.add input");
    await picker.setValue("#123456");
    await flushPromises();
    expect(savedSettings.value.customColors).toHaveLength(1);
    expect(savedSettings.value.customColors[0]!.value).toBe("#123456");
    expect(document.documentElement.style.getPropertyValue(`--note-${savedSettings.value.customColors[0]!.id}`)).toBe("#123456");
    expect(wrapper.findAll(".pool-item")).toHaveLength(8);

    const name = wrapper.find(".pool-name");
    await name.setValue("Ocean");
    await name.trigger("change");
    await flushPromises();
    expect(savedSettings.value.customColors[0]!.name).toBe("Ocean");

    await wrapper.find(".pool-action.danger").trigger("click");
    await flushPromises();
    expect(savedSettings.value.customColors).toHaveLength(0);
    expect(wrapper.findAll(".pool-item")).toHaveLength(7);
  });
});
