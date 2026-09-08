import { describe, expect, it } from "vitest";

import { moveItem } from "./sortable";

describe("moveItem", () => {
  it("moves a note forward without mutating the source", () => {
    const source = ["a", "b", "c", "d"];
    expect(moveItem(source, 1, 3)).toEqual(["a", "c", "d", "b"]);
    expect(source).toEqual(["a", "b", "c", "d"]);
  });

  it("moves a note backward", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("ignores invalid and unchanged positions", () => {
    const source = ["a", "b"];
    expect(moveItem(source, 0, 0)).toBe(source);
    expect(moveItem(source, -1, 1)).toBe(source);
  });
});
