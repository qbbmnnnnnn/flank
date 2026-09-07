import { watch } from "vue";
import { savedSettings } from "./settingsService";

export function installAppearance(): () => void {
  const system = window.matchMedia("(prefers-color-scheme: dark)");
  const apply = () => {
    const settings = savedSettings.value;
    const dark = settings.theme === "dark" || (settings.theme === "system" && system.matches);
    document.documentElement.dataset.theme = dark ? "dark" : "light";
    document.documentElement.lang = settings.language;
    document.documentElement.style.colorScheme = dark ? "dark" : "light";
  };
  const stop = watch(savedSettings, apply, { immediate: true, deep: true });
  system.addEventListener("change", apply);
  return () => { stop(); system.removeEventListener("change", apply); };
}
