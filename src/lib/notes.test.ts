import { describe, expect, it } from "vitest";
import { groupNotes, oxford } from "./notes";

describe("groupNotes", () => {
  it("folds notes that differ in one name", () => {
    expect(groupNotes([
      "Options for Maid Ellen come back after you close the game",
      "Options for Bunny come back after you close the game",
      "Options for Coca Cola come back after you close the game",
    ])).toEqual(["Options for Maid Ellen, Bunny, and Coca Cola come back after you close the game"]);
  });
  it("keeps different notes apart and drops repeats", () => {
    expect(groupNotes(["Turned on Burnice too, since Hat is its sub-mod", "It shows after the game reloads", "It shows after the game reloads"]))
      .toEqual(["Turned on Burnice too, since Hat is its sub-mod", "It shows after the game reloads"]);
  });
  it("folds errors only when the error is the same", () => {
    expect(groupNotes(["Couldn't change A: access denied", "Couldn't change B: access denied", "Couldn't change C: file in use"]))
      .toEqual(["Couldn't change A and B: access denied", "Couldn't change C: file in use"]);
  });
  it("counts past the limit", () => {
    expect(oxford(["a", "b", "c", "d", "e"], 3)).toBe("a, b, and 3 more");
    expect(oxford(["a", "b"])).toBe("a and b");
  });
});
