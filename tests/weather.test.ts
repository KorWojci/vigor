import { describe, expect, it } from "vitest";
import { decodeWeather, encodeWeather, weatherConditionLabel, WEATHER_CONDITIONS } from "@/lib/training/weather";

describe("weather encode/decode", () => {
  it("round-trips", () => {
    const w = { tempC: 14.2, humidityPct: 72, conditionCode: 23 };
    const encoded = encodeWeather(w);
    expect(JSON.parse(encoded!)).toEqual(w);
    expect(decodeWeather(encoded)).toEqual(w);
  });

  it("encodes to null when there is nothing to store", () => {
    expect(encodeWeather(null)).toBeNull();
    expect(encodeWeather(undefined)).toBeNull();
    expect(encodeWeather({ tempC: null, humidityPct: null, conditionCode: null })).toBeNull();
  });

  it("decodes null, malformed and partial input safely", () => {
    expect(decodeWeather(null)).toBeNull();
    expect(decodeWeather("not json")).toBeNull();
    expect(decodeWeather(JSON.stringify({ tempC: 12 }))).toEqual({ tempC: 12, humidityPct: null, conditionCode: null });
  });
});

describe("weather condition labels", () => {
  it("labels known HKWeatherCondition codes", () => {
    expect(weatherConditionLabel(1)).toBe("Clear");
    expect(weatherConditionLabel(8)).toBe("Windy");
    expect(weatherConditionLabel(23)).toBe("Showers");
  });

  it("returns null for an unknown code or no code at all, rather than a wrong label", () => {
    expect(weatherConditionLabel(9999)).toBeNull();
    expect(weatherConditionLabel(null)).toBeNull();
    expect(weatherConditionLabel(undefined)).toBeNull();
  });

  it("every condition code is a non-empty label", () => {
    for (const [code, label] of Object.entries(WEATHER_CONDITIONS)) {
      expect(label.length).toBeGreaterThan(0);
      expect(weatherConditionLabel(Number(code))).toBe(label);
    }
  });
});
