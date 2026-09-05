import { describe, expect, it } from "vitest";
import { dockLayout } from "./layout";

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
      const layout = dockLayout(20, 12, height);
      const noteHeight = height <= 800 ? 104 : 126;
      const step = noteHeight + layout.gap + layout.marginTop;
      expect(layout.windowHeight).toBeLessThanOrEqual(height);
      expect(layout.listHeight).toBe(28 + noteHeight + (layout.count - 1) * step);
    }
  });
});
