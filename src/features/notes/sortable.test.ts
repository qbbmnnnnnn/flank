import { describe, expect, it } from "vitest";

import { moveItem, restoreSortableDom } from "./sortable";

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

  it("restores Sortable's DOM move before Vue applies reactive order", () => {
    const list = document.createElement("div");
    list.innerHTML = '<i data-id="b"></i><i data-id="c"></i><i data-id="a"></i>';
    const moved = list.lastElementChild as HTMLElement;
    restoreSortableDom({ from: list, item: moved, oldIndex: 0 });
    expect([...list.children].map((item) => item.getAttribute("data-id"))).toEqual(["a", "b", "c"]);
  });
});
