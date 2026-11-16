import { describe, expect, it } from "vitest";
import { hostComputerRequest } from "./host-computer-protocol.js";
import { nativeScreenSupported } from "./native-screen.js";
import { isPrintableText, windowsKeyStrokes } from "./native-screen-keys.js";

describe("windows key strokes", () => {
  it("types a printable character as text, not as a key on the current layout", () => {
    expect(windowsKeyStrokes("a")).toEqual([
      { kind: "unicode", code: 0x61, up: false },
      { kind: "unicode", code: 0x61, up: true },
    ]);
    expect(windowsKeyStrokes("A")[0]).toEqual({ kind: "unicode", code: 0x41, up: false });
    expect(windowsKeyStrokes("?")[0]).toEqual({ kind: "unicode", code: 0x3f, up: false });
  });

  it("presses a named key down and up", () => {
    expect(windowsKeyStrokes("Enter")).toEqual([
      { kind: "vk", vk: 0x0d, extended: false, up: false },
      { kind: "vk", vk: 0x0d, extended: false, up: true },
    ]);
    expect(windowsKeyStrokes("f5")[0]).toEqual({
      kind: "vk",
      vk: 0x74,
      extended: false,
      up: false,
    });
  });

  it("marks the navigation keys the extended flag exists for", () => {
    expect(windowsKeyStrokes("up")[0]).toEqual({ kind: "vk", vk: 0x26, extended: true, up: false });
    expect(windowsKeyStrokes("delete")[0]).toEqual({
      kind: "vk",
      vk: 0x2e,
      extended: true,
      up: false,
    });
  });

  it("holds a chord's modifiers around the key and releases them in reverse", () => {
    expect(windowsKeyStrokes("ctrl+a")).toEqual([
      { kind: "vk", vk: 0x11, extended: false, up: false },
      { kind: "vk", vk: 0x41, extended: false, up: false },
      { kind: "vk", vk: 0x41, extended: false, up: true },
      { kind: "vk", vk: 0x11, extended: false, up: true },
    ]);
    expect(windowsKeyStrokes("c", ["ctrl", "shift"])).toEqual([
      { kind: "vk", vk: 0x11, extended: false, up: false },
      { kind: "vk", vk: 0x10, extended: false, up: false },
      { kind: "vk", vk: 0x43, extended: false, up: false },
      { kind: "vk", vk: 0x43, extended: false, up: true },
      { kind: "vk", vk: 0x10, extended: false, up: true },
      { kind: "vk", vk: 0x11, extended: false, up: true },
    ]);
  });

  it("uses the shortcut's own key code for punctuation in a chord", () => {
    expect(windowsKeyStrokes("/", ["ctrl"])).toEqual([
      { kind: "vk", vk: 0x11, extended: false, up: false },
      { kind: "vk", vk: 0xbf, extended: false, up: false },
      { kind: "vk", vk: 0xbf, extended: false, up: true },
      { kind: "vk", vk: 0x11, extended: false, up: true },
    ]);
  });

  it("names what it cannot press instead of guessing", () => {
    expect(() => windowsKeyStrokes("nope")).toThrow("Unknown key: nope");
    expect(() => windowsKeyStrokes("ctrl+nope")).toThrow("Unknown key: nope");
    expect(() => windowsKeyStrokes("hyper+a")).toThrow("Unknown modifier key: hyper");
    expect(() => windowsKeyStrokes("")).toThrow("No key to press");
  });

  it("separates one printable character from a key name", () => {
    expect(isPrintableText(" ")).toBe(true);
    expect(isPrintableText("ab")).toBe(false);
    expect(isPrintableText("\n")).toBe(false);
  });
});

describe("host computer screen requests", () => {
  it("accepts the screen calls a bot makes", () => {
    expect(hostComputerRequest.safeParse({ botId: "bot", method: "observe" }).success).toBe(true);
    expect(
      hostComputerRequest.safeParse({
        botId: "bot",
        method: "act",
        actions: [{ kind: "pointer", x: 12, y: 30, type: "click" }],
        observe: false,
      }).success,
    ).toBe(true);
    expect(
      hostComputerRequest.safeParse({
        botId: "bot",
        method: "act",
        actions: [{ kind: "key", key: "ctrl+a" }],
      }).success,
    ).toBe(true);
  });

  it("refuses a batch over the action limit, and any action it cannot name", () => {
    expect(
      hostComputerRequest.safeParse({
        botId: "bot",
        method: "act",
        actions: Array.from({ length: 25 }, () => ({ kind: "clipboard", text: "x" })),
      }).success,
    ).toBe(false);
    expect(
      hostComputerRequest.safeParse({
        botId: "bot",
        method: "act",
        actions: [{ kind: "teleport", x: 1, y: 1 }],
      }).success,
    ).toBe(false);
  });
});

describe("native screen support", () => {
  it("offers a display only on the platform this build drives", () => {
    expect(nativeScreenSupported("win32")).toBe(true);
    expect(nativeScreenSupported("linux")).toBe(false);
    expect(nativeScreenSupported("darwin")).toBe(false);
  });
});
