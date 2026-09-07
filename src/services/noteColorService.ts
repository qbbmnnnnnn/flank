import { watch } from "vue";

import type { AppSettings } from "../contracts/app";
import { CUSTOM_NOTE_COLOR_PREFIX, type NoteColor, type NoteColorId, type NoteColorOption } from "../contracts/note";
import { savedSettings } from "./settingsService";

export const builtinNoteColors: NoteColorOption[] = [
  { id: "lemon", name: "Lemon" },
  { id: "peach", name: "Peach" },
  { id: "rose", name: "Rose" },
  { id: "lilac", name: "Lilac" },
  { id: "sky", name: "Sky" },
  { id: "mint", name: "Mint" },
];

// Fallbacks only: the shared `--note-*` custom properties remain the source of truth,
// so every window agrees and the dark theme still dims paper without shifting hue.
const BUILTIN_HSL: Record<NoteColor, { h: number; s: number; l: number }> = {
  lemon: { h: 48, s: 100, l: 74 },
  peach: { h: 12, s: 100, l: 83 },
  rose: { h: 339, s: 75, l: 84 },
  lilac: { h: 262, s: 100, l: 88 },
  sky: { h: 210, s: 100, l: 84 },
  mint: { h: 160, s: 54, l: 78 },
};

const builtinIds = new Set(builtinNoteColors.map((color) => color.id));
// Remembered so notes already painted in a deleted user color keep rendering.
const knownValues = new Map<string, string>();
const registered = new Set<string>();
const registeredInk = new Set<string>();

/** Ink stays legible on pale paper; keep ink for hostile paper and use paper-friendly paper-ink. */
const INK_ON_PAPER = "#2f2a2b";
const INK_ON_DARK_PAPER = "#fdfcfb";
const INK_SOFT_ALPHA = "b3";
/** Below this relative luminance, white text wins the WCAG contrast comparison. */
const LUMINANCE_THRESHOLD = 0.179;

export function isBuiltinNoteColor(id: string): boolean {
  return builtinIds.has(id);
}

export function builtinNoteColorHex(id: NoteColor): string {
  const { h, s, l } = BUILTIN_HSL[id];
  const { r, g, b } = hslToRgb(h, s, l);
  return `#${[r, g, b].map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

export function noteColorCss(color: NoteColorId): string {
  const fallback = knownValues.get(color) ?? (BUILTIN_HSL[color as NoteColor] ? builtinNoteColorHex(color as NoteColor) : "");
  return fallback ? `var(--note-${color}, ${fallback})` : `var(--note-${color})`;
}

function cssNumber(name: string): number | null {
  if (typeof window === "undefined") return null;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  if (!raw) return null;
  const value = Number.parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function parseHex(value: string): { r: number; g: number; b: number } | null {
  const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const number = Number.parseInt(match[1], 16);
  return { r: (number >> 16) & 255, g: (number >> 8) & 255, b: number & 255 };
}

function hslToRgb(h: number, s: number, l: number) {
  const hue = ((h % 360) + 360) % 360;
  const saturation = Math.min(100, Math.max(0, s)) / 100;
  const lightness = Math.min(100, Math.max(0, l)) / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
  const match = lightness - chroma / 2;
  const sector = Math.floor(hue / 60) % 6;
  const channels = [
    [chroma, secondary, 0],
    [secondary, chroma, 0],
    [0, chroma, secondary],
    [0, secondary, chroma],
    [secondary, 0, chroma],
    [chroma, 0, secondary],
  ][sector] ?? [0, 0, 0];
  return {
    r: Math.round((channels[0] + match) * 255),
    g: Math.round((channels[1] + match) * 255),
    b: Math.round((channels[2] + match) * 255),
  };
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  const channel = (value: number) => {
    const ratio = value / 255;
    return ratio <= 0.03928 ? ratio / 12.92 : ((ratio + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

/** The paper's own color *after* the theme saturation/lightness multipliers. */
function currentPaperRgb(id: string) {
  const custom = knownValues.get(id);
  if (custom) return parseHex(custom);
  const base = BUILTIN_HSL[id as NoteColor];
  if (!base) return null;
  const h = cssNumber(`--note-${id}-h`) ?? base.h;
  const s = (cssNumber(`--note-${id}-s`) ?? base.s) * (cssNumber("--note-saturation") ?? 1);
  const l = (cssNumber(`--note-${id}-l`) ?? base.l) * (cssNumber("--note-lightness") ?? 1);
  return hslToRgb(h, s, l);
}

/** Pick ink by contrast against the *rendered* paper, so themes never fight it. */
export function noteInkFor(id: string): { ink: string; soft: string } {
  const paper = currentPaperRgb(id);
  const bright = paper ? relativeLuminance(paper) > LUMINANCE_THRESHOLD : true;
  const ink = bright ? INK_ON_PAPER : INK_ON_DARK_PAPER;
  return { ink, soft: `${ink}${INK_SOFT_ALPHA}` };
}

export function noteInkCss(color: NoteColorId): string {
  const { ink } = noteInkFor(color);
  return `var(--note-ink-${color}, ${ink})`;
}

export function noteInkSoftCss(color: NoteColorId): string {
  const { soft } = noteInkFor(color);
  return `var(--note-ink-soft-${color}, ${soft})`;
}

/** One style object for every surface painted with this color. */
export function notePaperStyle(color: NoteColorId): Record<string, string> {
  return {
    "--paper": noteColorCss(color),
    "--paper-ink": noteInkCss(color),
    "--paper-ink-soft": noteInkSoftCss(color),
    "--note": noteColorCss(color),
    "--note-ink": noteInkCss(color),
    "--note-ink-soft": noteInkSoftCss(color),
  };
}

/** The six built-in colors followed by the user's own colors. */
export function noteColorPool(settings: Pick<AppSettings, "customColors">): NoteColorOption[] {
  return [...builtinNoteColors, ...(settings.customColors ?? [])];
}

export function pickRandomNoteColor(settings: Pick<AppSettings, "customColors">): NoteColorId {
  const pool = noteColorPool(settings);
  return pool[Math.floor(Math.random() * pool.length)]?.id ?? "lemon";
}

export function createNoteColorId(): string {
  return `${CUSTOM_NOTE_COLOR_PREFIX}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

function applyInkVars(ids: Iterable<string>) {
  const style = document.documentElement.style;
  const next = new Set(ids);
  for (const id of [...registeredInk]) {
    if (next.has(id)) continue;
    style.removeProperty(`--note-ink-${id}`);
    style.removeProperty(`--note-ink-soft-${id}`);
    registeredInk.delete(id);
  }
  for (const id of next) {
    const { ink, soft } = noteInkFor(id);
    style.setProperty(`--note-ink-${id}`, ink);
    style.setProperty(`--note-ink-soft-${id}`, soft);
    registeredInk.add(id);
  }
}

function applyNoteVars() {
  if (typeof document === "undefined") return;
  const style = document.documentElement.style;
  const colors = savedSettings.value.customColors ?? [];
  const next = new Set(colors.map((color) => color.id));
  for (const id of [...registered]) {
    if (next.has(id)) continue;
    style.removeProperty(`--note-${id}`);
    registered.delete(id);
  }
  for (const color of colors) {
    if (!color.value) continue;
    knownValues.set(color.id, color.value);
    style.setProperty(`--note-${color.id}`, color.value);
    registered.add(color.id);
  }
  applyInkVars([...builtinIds, ...next]);
}

/**
 * Publish user colors as `--note-<id>` so every window renders them like built-ins,
 * and each paper's own ink as `--note-ink-<id>` / `--note-ink-soft-<id>`.
 * Ink is recomputed whenever the theme changes, because the theme dims paper too.
 */
export function installNoteColors(): () => void {
  const stop = watch(() => savedSettings.value.customColors, applyNoteVars, { immediate: true, deep: true });
  const observer = typeof MutationObserver === "undefined" ? undefined : new MutationObserver(applyNoteVars);
  observer?.observe(document.documentElement, { attributeFilter: ["data-theme"] });
  return () => { stop(); observer?.disconnect(); };
}
