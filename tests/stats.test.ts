import { describe, expect, it } from "vitest";
import { linearRegression } from "@/lib/stats";

describe("linearRegression", () => {
  it("returns null with fewer than 2 points", () => {
    expect(linearRegression([])).toBeNull();
    expect(linearRegression([{ x: 0, y: 1 }])).toBeNull();
  });

  it("returns null when every point shares the same x (no line to fit)", () => {
    expect(linearRegression([{ x: 5, y: 1 }, { x: 5, y: 2 }, { x: 5, y: 3 }])).toBeNull();
  });

  it("recovers an exact line with a perfect fit", () => {
    const fit = linearRegression([{ x: 0, y: 2 }, { x: 1, y: 4 }, { x: 2, y: 6 }, { x: 3, y: 8 }])!;
    expect(fit.slope).toBeCloseTo(2, 10);
    expect(fit.intercept).toBeCloseTo(2, 10);
    expect(fit.r2).toBeCloseTo(1, 10);
    expect(fit.predict(10)).toBeCloseTo(22, 10);
  });

  it("reports a low r2 for scattered, directionless data", () => {
    const fit = linearRegression([{ x: 0, y: 10 }, { x: 1, y: 2 }, { x: 2, y: 9 }, { x: 3, y: 1 }, { x: 4, y: 8 }])!;
    expect(fit.r2).toBeLessThan(0.2);
  });
});
