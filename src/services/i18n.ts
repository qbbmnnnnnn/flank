import { savedSettings } from "./settingsService";
import { messages } from "./messages";

export function t(source: string, params: Record<string, string | number> = {}): string {
  const text = savedSettings.value.language === "en-US" ? messages[source] ?? source : source;
  return text.replace(/\{(\w+)\}/g, (match, key: string) => String(params[key] ?? match));
}

export function formatRelativeTime(value: number): string {
  const seconds = Math.max(0, (Date.now() - value) / 1000);
  if (seconds < 60) return t("刚刚");
  const format = new Intl.RelativeTimeFormat(savedSettings.value.language, { numeric: "always" });
  if (seconds < 3600) return format.format(-Math.floor(seconds / 60), "minute");
  if (seconds < 86400) return format.format(-Math.floor(seconds / 3600), "hour");
  if (seconds < 604800) return format.format(-Math.floor(seconds / 86400), "day");
  return new Intl.DateTimeFormat(savedSettings.value.language, { month: "short", day: "numeric" }).format(value);
}
