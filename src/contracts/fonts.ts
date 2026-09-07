/** A selectable note body font. */
export interface NoteFontOption {
  /** Persisted in settings. */
  id: string;
  /** Chinese label; doubles as the i18n source string for the English copy. */
  name: string;
  /** CSS font stack applied to note text and Markdown previews. */
  stack: string;
}

/**
 * Latin + system CJK fallbacks appended to every CJK stack. Browsers resolve
 * glyph by glyph, so mixed Chinese / English notes stay legible even when the
 * selected face has no glyph for a character.
 */
const NOTE_FONT_FALLBACK = `Geist, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;

/** TsangerYuYangT W03 is the regular weight, so it is the shipped default. */
export const DEFAULT_NOTE_FONT = "yuyang";

/**
 * Note body fonts. `name` is the Chinese label and doubles as the i18n source
 * string (see services/messages.ts for the English copy).
 */
export const noteFontOptions: readonly NoteFontOption[] = [
  { id: "yuyang", name: "渔阳体", stack: `"Noty YuYang", ${NOTE_FONT_FALLBACK}` },
  { id: "huangyou", name: "黄油体", stack: `"Noty Display", ${NOTE_FONT_FALLBACK}` },
  { id: "happy", name: "快乐体", stack: `"Noty Happy", ${NOTE_FONT_FALLBACK}` },
  { id: "wenyi", name: "文艺体", stack: `"Noty Wenyi", ${NOTE_FONT_FALLBACK}` },
  { id: "kuhei", name: "黑体", stack: `"Noty KuHei", ${NOTE_FONT_FALLBACK}` },
];

export function isNoteFontId(value: unknown): boolean {
  return noteFontOptions.some((option) => option.id === value);
}

/** Falls back to the default face so a removed or unknown id never blanks note text. */
export function noteFontStack(id: string): string {
  const option = noteFontOptions.find((item) => item.id === id);
  return (option ?? noteFontOptions.find((item) => item.id === DEFAULT_NOTE_FONT)!).stack;
}
