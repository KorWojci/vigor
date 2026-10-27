import { describe, expect, it } from "vitest";
import { decodeRoute, encodeRoute, routeDistanceMeters, type RoutePoint } from "@/lib/training/route";
import { nearestCity, placeLabel } from "@/lib/geo/nearest-city";

describe("route encode/decode", () => {
  it("round-trips and sorts by time", () => {
    const points: RoutePoint[] = [
      { t: 30, lat: 52.408, lon: 16.931, ele: null },
      { t: 0, lat: 52.4069, lon: 16.9299, ele: 68.4 },
    ];
    const encoded = encodeRoute(points);
    expect(JSON.parse(encoded)).toEqual([[0, 52.4069, 16.9299, 68.4], [30, 52.408, 16.931, null]]);
    expect(decodeRoute(encoded)).toEqual([{ t: 0, lat: 52.4069, lon: 16.9299, ele: 68.4 }, { t: 30, lat: 52.408, lon: 16.931, ele: null }]);
  });

  it("decodes null, malformed and empty input to null rather than throwing", () => {
    expect(decodeRoute(null)).toBeNull();
    expect(decodeRoute("not json")).toBeNull();
    expect(decodeRoute("[]")).toBeNull();
    expect(decodeRoute(JSON.stringify([["not", "numbers", "here"]]))).toBeNull();
  });

  it("sums distance between consecutive points", () => {
    // Two points 0.01° apart in latitude only, at the equator: 0.01 * 110_540 m/°.
    const points: RoutePoint[] = [{ t: 0, lat: 0, lon: 0, ele: null }, { t: 10, lat: 0.01, lon: 0, ele: null }];
    expect(routeDistanceMeters(points)).toBeCloseTo(1105.4, 0);
    expect(routeDistanceMeters([points[0]])).toBe(0);
  });
});

describe("nearest city (offline, no network)", () => {
  it("finds well-known cities close to their real coordinates", () => {
    expect(nearestCity(52.4064, 16.9252)?.name).toBe("Poznań");
    expect(nearestCity(53.4084, -2.9916)?.name).toBe("Liverpool");
  });

  it("labels a point near a known city, qualifies a distant one, and omits remote ones", () => {
    expect(placeLabel(52.4064, 16.9252)).toBe("Poznań, PL");
    // ~36 km from Alice Springs (outback) — too far to claim, close enough to name with a caveat.
    expect(placeLabel(-24, 134)).toBe("near Alice Springs, AU (~36 km)");
    // Mid-Pacific, nowhere near a city of 15,000+.
    expect(placeLabel(0, -150)).toBeNull();
  });
});
