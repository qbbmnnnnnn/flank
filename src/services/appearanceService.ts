import { watch } from "vue";
import { savedSettings } from "./settingsService";
import { noteFontStack } from "../contracts/fonts";

export function installAppearance(): () => void {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const settings = savedSettings.value;
    const dark = settings.theme === "dark" || (settings.theme === "system" && system.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.lang = settings.language;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
    // Note text and the whole interface share one face, so a pick is visible everywhere.
    const fontStack = noteFontStack(settings.font);
    document.documentElement.style.setProperty("--display", fontStack);
    document.documentElement.style.setProperty("--note-font", fontStack);
    document.documentElement.style.setProperty("--note-body-font-size", `${settings.fontSize}px`);
  };
  const stop = watch(savedSettings, apply, { immediate: true, deep: true });
  system.addEventListener("change", apply);
  return () => { stop(); system.removeEventListener("change", apply); };
}
