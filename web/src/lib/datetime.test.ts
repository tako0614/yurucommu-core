import { test, expect } from "bun:test";
import { formatRelativeTime } from "./datetime.ts";

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

test("formatRelativeTime localizes the compact suffix (ja)", () => {
  expect(formatRelativeTime(ago(10_000), { locale: "ja" })).toBe("今");
  expect(formatRelativeTime(ago(5 * MIN), { locale: "ja" })).toBe("5分");
  expect(formatRelativeTime(ago(3 * HOUR), { locale: "ja" })).toBe("3時間");
  expect(formatRelativeTime(ago(2 * DAY), { locale: "ja" })).toBe("2日");
});

test("formatRelativeTime keeps the Twitter-style compact suffix (en)", () => {
  expect(formatRelativeTime(ago(10_000), { locale: "en" })).toBe("now");
  expect(formatRelativeTime(ago(5 * MIN), { locale: "en" })).toBe("5m");
  expect(formatRelativeTime(ago(3 * HOUR), { locale: "en" })).toBe("3h");
  expect(formatRelativeTime(ago(2 * DAY), { locale: "en" })).toBe("2d");
});

test("formatRelativeTime defaults to en suffixes when no locale is given", () => {
  expect(formatRelativeTime(ago(3 * HOUR))).toBe("3h");
});
