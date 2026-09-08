import type { AppSettings } from "./app";
import { isNoteFontId, DEFAULT_NOTE_FONT } from "./fonts";
import {
  CUSTOM_NOTE_COLOR_PREFIX,
  MAX_CUSTOM_NOTE_COLORS,
  type NoteColorOption,
} from "./note";

export const defaultSettings: AppSettings = {
  language: "zh-CN", theme: "system", launchAtLogin: false, closeBehavior: "background",
  dockEnabled: true, dockVisibleCount: 5, dockSide: "right", verticalPosition: 50,
  dockSize: "medium", hoverAnimation: true, actionDelay: 1, fullscreenBehavior: "hide",
  displayPreference: "cursor", font: DEFAULT_NOTE_FONT, fontSize: 16, textDirection: "automatic",
  markdown: true, defaultColor: "random", customColors: [], automaticUpdates: true,
};

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

/** Keep stored user colors small, valid and uniquely identified. */
function normalizeCustomColors(value: unknown): NoteColorOption[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const colors: NoteColorOption[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const candidate = item as Partial<NoteColorOption>;
    const id = typeof candidate.id === "string" ? candidate.id : "";
    const hex = typeof candidate.value === "string" ? candidate.value.trim().toLowerCase() : "";
    if (!id.startsWith(CUSTOM_NOTE_COLOR_PREFIX) || !HEX_COLOR.test(hex)) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    colors.push({ id, name: (typeof candidate.name === "string" ? candidate.name.trim() : "").slice(0, 24) || hex, value: hex });
    if (colors.length >= MAX_CUSTOM_NOTE_COLORS) break;
  }
  return colors;
}

export function normalizeSettings(value: Partial<AppSettings>): AppSettings {
  return {
    ...defaultSettings, ...value,
    language: ["zh-CN", "en-US"].includes(value.language ?? "") ? value.language! : "zh-CN",
    theme: ["system", "light", "dark"].includes(value.theme ?? "") ? value.theme! : "system",
    closeBehavior: value.closeBehavior === "quit" ? "quit" : "background",
    dockSize: ["small", "medium", "large"].includes(value.dockSize ?? "") ? value.dockSize! : "medium",
    font: isNoteFontId(value.font) ? value.font! : DEFAULT_NOTE_FONT,
    fontSize: Math.min(22, Math.max(13, Math.round(Number(value.fontSize) || defaultSettings.fontSize))),
    customColors: normalizeCustomColors(value.customColors),
  };
}
