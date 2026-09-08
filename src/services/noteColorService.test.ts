import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { builtinNoteColorHex, installNoteColors, noteInkFor, notePaperStyle } from "./noteColorService";
import { initializeSettings, saveSettingsPatch } from "./settingsService";

const stopNoteColors = installNoteColors();

describe("paper contrast", () => {
  beforeAll(async () => {
    await initializeSettings();
  });

  afterAll(() => {
    stopNoteColors();
  });

  it("keeps dark ink on the pale built-in papers", () => {
    for (const id of ["lemon", "peach", "rose", "lilac", "sky", "mint"]) {
      expect(noteInkFor(id).ink).toBe("#2f2a2b");
    }
  });

  it("switches to light ink once a paper gets dark", async () => {
    await saveSettingsPatch({
      customColors: [
        { id: "custom-test-dark", name: "Deep blue", value: "#123456" },
        { id: "custom-test-dark2", name: "Charcoal", value: "#1f2937" },
        { id: "custom-test-light", name: "Cream", value: "#fdf6e3" },
      ],
    });

    expect(noteInkFor("custom-test-dark").ink).toBe("#fdfcfb");
    expect(noteInkFor("custom-test-dark2").ink).toBe("#fdfcfb");
    expect(noteInkFor("custom-test-light").ink).toBe("#2f2a2b");

    const darkStyle = notePaperStyle("custom-test-dark");
    expect(darkStyle["--note-task-border"]).toBe("var(--note-task-border-custom-test-dark, #fdfcfb)");
    expect(darkStyle["--note-task-fill"]).toBe("var(--note-task-fill-custom-test-dark, #fdfcfb)");
    expect(darkStyle["--note-task-check"]).toBe("var(--note-task-check-custom-test-dark, var(--note-custom-test-dark, #123456))");
  });

  it("derives hex fallbacks from the shared HSL paper definitions", () => {
    expect(builtinNoteColorHex("lemon")).toBe("#ffe47a");
    expect(builtinNoteColorHex("mint")).toBe("#a9e5d1");
  });

  it("exposes paper and ink together for paper surfaces", () => {
    const style = notePaperStyle("lemon");
    expect(style["--paper"]).toBe("var(--note-lemon, #ffe47a)");
    expect(style["--paper-ink"]).toBe("var(--note-ink-lemon, #2f2a2b)");
    expect(style["--paper-ink-soft"]).toBe("var(--note-ink-soft-lemon, #2f2a2bb3)");
  });
});
