import { describe, expect, it } from "vitest";
import { dockLayout, dockMetrics, MAX_PEEK, VISIBLE_TITLE_STRIP, type DockSize } from "./layout";

const SIZES = ["small", "medium", "large"] as DockSize[];

describe("Dock height", () => {
  it("grows from one note through five and stops at the configured limit", () => {
    const heights = [1, 2, 3, 4, 5, 6, 20].map(count => dockLayout(count, 5, 1080).windowHeight);
    for (let i = 1; i < 5; i++) expect(heights[i]).toBeGreaterThan(heights[i - 1]);
    expect(heights[5]).toBe(heights[4]);
    expect(heights[6]).toBe(heights[4]);
    expect(dockLayout(1, 5, 1080).listHeight).toBe(126 + 28);
  });

  it("uses one guide note when empty and shrinks after deletion", () => {
    expect(dockLayout(0, 5, 1080)).toEqual(dockLayout(1, 5, 1080));
    expect(dockLayout(2, 5, 1080).windowHeight).toBeLessThan(dockLayout(5, 5, 1080).windowHeight);
  });

  it("honors a custom maximum when the display has room", () => {
    expect(dockLayout(10, 7, 1440).count).toBe(7);
    expect(dockLayout(8, 7, 1440).windowHeight).toBe(dockLayout(7, 7, 1440).windowHeight);
  });

  it("preserves the original stacked-paper spacing", () => {
    expect(dockLayout(1, 5, 1080).marginTop).toBe(-16);
    expect(dockLayout(1, 5, 1080).gap).toBe(2);
    expect(dockLayout(1, 5, 768).marginTop).toBe(-14);
    expect(dockLayout(1, 5, 768).gap).toBe(1);
  });

  it("fits only complete notes and never exceeds the display", () => {
    for (const height of [600, 720, 768, 800, 900, 1080, 1440]) {
      for (const size of ["small", "medium", "large"] as DockSize[]) {
        const layout = dockLayout(20, 12, height, size);
        const step = layout.noteHeight + layout.gap + layout.marginTop;
        expect(layout.windowHeight).toBeLessThanOrEqual(height);
        expect(layout.listHeight).toBe(28 + layout.noteHeight + (layout.count - 1) * step);
      }
    }
  });

  it("scales card height and title size with the dock size", () => {
    const sizes = ["small", "medium", "large"] as DockSize[];
    const heights = sizes.map(size => dockLayout(1, 5, 1080, size).noteHeight);
    const titles = sizes.map(size => dockLayout(1, 5, 1080, size).titleSize);
    for (let i = 1; i < sizes.length; i++) {
      expect(heights[i]).toBeGreaterThan(heights[i - 1]);
      expect(titles[i]).toBeGreaterThan(titles[i - 1]);
    }
    expect(heights[1]).toBe(126);
    expect(titles[1]).toBe(16);
  });

  it("scales the rail width, tab width and action button size with the dock size", () => {
    const sizes = ["small", "medium", "large"] as DockSize[];
    const rails = sizes.map(size => dockLayout(1, 5, 1080, size).railWidth);
    const tabs = sizes.map(size => dockLayout(1, 5, 1080, size).tabWidth);
    const buttons = sizes.map(size => dockLayout(1, 5, 1080, size).actionBtn);
    const icons = sizes.map(size => dockLayout(1, 5, 1080, size).actionIcon);
    for (let i = 1; i < sizes.length; i++) {
      expect(rails[i]).toBeGreaterThan(rails[i - 1]);
      expect(tabs[i]).toBeGreaterThan(tabs[i - 1]);
      expect(buttons[i]).toBeGreaterThan(buttons[i - 1]);
      expect(icons[i]).toBeGreaterThan(icons[i - 1]);
    }
    expect(rails[1]).toBe(104);
    expect(tabs[1]).toBe(88);
    expect(buttons[1]).toBe(26);
    expect(icons[1]).toBe(14);
    // The hover scale tracks the rail so the peek distance scales too.
    expect(dockLayout(1, 5, 1080, "small").scale).toBeCloseTo(88 / 104, 3);
    expect(dockLayout(1, 5, 1080, "large").scale).toBeCloseTo(120 / 104, 3);
  });

  it("hides the dashed fold and keeps the card flush to the screen edge", () => {
    for (const size of SIZES) {
      for (const height of [768, 1080, 1440]) {
        const m = dockMetrics(height, size);
        // Idle state only reveals the leading strip of the card.
        const visibleStrip = m.tabWidth + m.tabMargin;
        expect(visibleStrip).toBe(VISIBLE_TITLE_STRIP);
        // The fold must sit beyond that strip, otherwise it peeks out while idle.
        expect(m.spineOffset).toBeGreaterThan(visibleStrip);
        // The card must still overhang the window after the largest inward travel.
        expect(m.tabMargin + MAX_PEEK * m.scale).toBeLessThan(0);
      }
    }
  });

  it("keeps medium as the default and fits fewer cards when they grow", () => {
    expect(dockLayout(1, 5, 1080)).toEqual(dockLayout(1, 5, 1080, "medium"));
    expect(dockLayout(20, 12, 1080, "large").count).toBeLessThan(dockLayout(20, 12, 1080, "small").count);
    expect(dockLayout(5, 5, 1080, "large").windowHeight).toBeGreaterThan(dockLayout(5, 5, 1080, "small").windowHeight);
  });
});
