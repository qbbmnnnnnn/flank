export function dockLayout(noteCount: number, maximum: number, screenHeight: number) {
  const compact = screenHeight <= 800;
  const noteHeight = compact ? 104 : 126;
  // Preserve the original stacked-paper spacing: 2 - 16 = -14px,
  // or 1 - 14 = -13px on compact displays.
  const gap = compact ? 1 : 2;
  const marginTop = compact ? -14 : -16;
  const step = noteHeight + gap + marginTop;
  const limit = Math.min(12, Math.max(5, Math.round(maximum) || 5));
  // 28px list padding + 108px controls + 6px rail padding + 16px screen margin.
  const capacity = Math.max(1, 1 + Math.floor((screenHeight - 158 - noteHeight) / step));
  const count = Math.min(Math.max(1, noteCount), limit, capacity);
  const listHeight = 28 + noteHeight + (count - 1) * step;
  return { count, listHeight, windowHeight: listHeight + 130, gap, marginTop };
}
