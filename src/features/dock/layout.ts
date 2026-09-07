export type DockSize = "small" | "medium" | "large";

/** Per-size rail, card and action-button metrics in logical pixels. `medium` is the original design. */
const RAIL_WIDTH: Record<DockSize, number> = { small: 88, medium: 104, large: 120 };
/**
 * Width of the card's leading strip — the sliver of paper left of the dashed
 * fold that stays on screen while the card is idle.
 */
const LEAD_STRIP: Record<DockSize, number> = { small: 32, medium: 38, large: 44 };
/**
 * How far the card overhangs the window on the screen-edge side. It has to
 * outlast the largest inward travel (`MAX_PEEK * scale`) or the card detaches
 * from the screen edge on hover, but it also must not exceed
 * `MAX_PEEK * scale + actionEdge`, otherwise the action buttons stay clipped.
 */
const TAB_OVERHANG: Record<DockSize, number> = { small: 44, medium: 48, large: 60 };
const NOTE_HEIGHT: Record<DockSize, { regular: number; compact: number }> = {
  small: { regular: 110, compact: 92 },
  medium: { regular: 126, compact: 104 },
  large: { regular: 146, compact: 120 },
};
const TITLE_SIZE: Record<DockSize, { regular: number; compact: number }> = {
  small: { regular: 14, compact: 12 },
  medium: { regular: 16, compact: 14 },
  large: { regular: 18, compact: 16 },
};
const ACTION_BTN: Record<DockSize, number> = { small: 22, medium: 26, large: 30 };
const ACTION_ICON: Record<DockSize, number> = { small: 12, medium: 14, large: 16 };
const ACTION_GAP: Record<DockSize, number> = { small: 5, medium: 7, large: 9 };
const ACTION_EDGE: Record<DockSize, number> = { small: 6, medium: 6, large: 7 };
const ACTION_SPINE: Record<DockSize, number> = { small: 6, medium: 7, large: 8 };

const BASE_RAIL_WIDTH = RAIL_WIDTH.medium;

/** The dashed fold sits this far past the leading strip so it never peeks out while idle. */
const FOLD_MARGIN = 4;
/** Breathing room between the vertical title column and the screen edge. */
const TITLE_EDGE = 2;

/** Largest inward travel of a card: 42px full hover + 4px hover offset. */
export const MAX_PEEK = 46;

/** All dock metrics for a given display height and chosen size. */
export function dockMetrics(screenHeight: number, size: DockSize = "medium") {
  const compact = screenHeight <= 800;
  const variant = compact ? "compact" : "regular";
  const baseNoteHeight = NOTE_HEIGHT.medium[variant];
  const noteHeight = NOTE_HEIGHT[size]?.[variant] ?? baseNoteHeight;
  const railWidth = RAIL_WIDTH[size] ?? BASE_RAIL_WIDTH;
  // Preserve the original stacked-paper spacing: 2 - 16 = -14px,
  // or 1 - 14 = -13px on compact displays.
  const gap = compact ? 1 : 2;
  const marginTop = Math.round((compact ? -14 : -16) * (noteHeight / baseNoteHeight));
  // A single scale anchors both axes so hover offsets and influence radii
  // stay proportional to the rail width and card height simultaneously.
  const scale = railWidth / BASE_RAIL_WIDTH;
  const leadStrip = LEAD_STRIP[size] ?? LEAD_STRIP.medium;
  const overhang = TAB_OVERHANG[size] ?? TAB_OVERHANG.medium;
  return {
    compact,
    railWidth,
    /** Only the leading strip is on screen while the card is idle. */
    leadStrip,
    tabWidth: leadStrip + overhang,
    tabMargin: -overhang,
    /** Distance from the card's leading edge to the dashed fold. */
    spineOffset: leadStrip + FOLD_MARGIN,
    titleWidth: leadStrip - TITLE_EDGE,
    noteHeight,
    titleSize: TITLE_SIZE[size]?.[variant] ?? TITLE_SIZE.medium[variant],
    gap,
    marginTop,
    actionBtn: ACTION_BTN[size] ?? ACTION_BTN.medium,
    actionIcon: ACTION_ICON[size] ?? ACTION_ICON.medium,
    actionGap: ACTION_GAP[size] ?? ACTION_GAP.medium,
    actionEdge: ACTION_EDGE[size] ?? ACTION_EDGE.medium,
    actionSpine: ACTION_SPINE[size] ?? ACTION_SPINE.medium,
    scale,
  };
}

export function dockLayout(noteCount: number, maximum: number, screenHeight: number, size: DockSize = "medium") {
  const m = dockMetrics(screenHeight, size);
  const step = m.noteHeight + m.gap + m.marginTop;
  const limit = Math.min(12, Math.max(5, Math.round(maximum) || 5));
  // 28px list padding + 108px controls + 6px rail padding + 16px screen margin.
  const capacity = Math.max(1, 1 + Math.floor((screenHeight - 158 - m.noteHeight) / step));
  const count = Math.min(Math.max(1, noteCount), limit, capacity);
  const listHeight = 28 + m.noteHeight + (count - 1) * step;
  return { count, listHeight, windowHeight: listHeight + 130, ...m };
}
