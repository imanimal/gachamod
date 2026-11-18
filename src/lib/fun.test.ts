import { describe, expect, it } from "vitest";
import { season } from "./fun";

const on = (y: number, m: number, d: number) => season(new Date(y, m - 1, d, 12));

describe("season", () => {
  it("follows the calendar", () => {
    expect(on(2026, 10, 23)).toBeNull();
    expect(on(2026, 10, 24)).toBe("halloween");
    expect(on(2026, 10, 31)).toBe("halloween");
    expect(on(2026, 11, 1)).toBeNull();
    expect(on(2026, 12, 19)).toBeNull();
    expect(on(2026, 12, 20)).toBe("winter");
    expect(on(2027, 1, 2)).toBe("winter");
    expect(on(2027, 1, 3)).toBeNull();
    expect(on(2027, 2, 14)).toBe("valentine");
  });
  it("gives Lunar New Year its first 15 days", () => {
    expect(on(2027, 2, 5)).toBeNull();
    expect(on(2027, 2, 6)).toBe("lunar");
    expect(on(2027, 2, 20)).toBe("lunar");
    expect(on(2027, 2, 21)).toBeNull();
    expect(on(2028, 1, 26)).toBe("lunar");
    expect(on(2028, 2, 9)).toBe("lunar");
    expect(on(2026, 2, 14)).toBe("valentine");
    expect(on(2026, 2, 17)).toBe("lunar");
  });
});
