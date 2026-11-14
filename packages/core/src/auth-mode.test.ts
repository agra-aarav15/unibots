import { describe, expect, it } from "vitest";
import { isLocalAuthMode } from "./auth-mode.js";

describe("isLocalAuthMode", () => {
  it("accepts any spelling and spacing of local", () => {
    expect(isLocalAuthMode("local")).toBe(true);
    expect(isLocalAuthMode("Local")).toBe(true);
    expect(isLocalAuthMode(" LOCAL ")).toBe(true);
  });

  it("is off when unset or set to anything else", () => {
    expect(isLocalAuthMode(undefined)).toBe(false);
    expect(isLocalAuthMode("")).toBe(false);
    expect(isLocalAuthMode("oauth")).toBe(false);
  });
});