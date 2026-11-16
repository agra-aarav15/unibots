import { describe, expect, it } from "vitest";
import { DesktopScreenTurn } from "./desktop-screen-turn.js";

const TURN_MS = 120_000;

describe("one display shared by several bots", () => {
  it("lets the first bot act and keeps the other out while its hold lasts", () => {
    const turn = new DesktopScreenTurn(TURN_MS);
    expect(turn.claim("bot-a", 1_000)).toBe(true);
    expect(turn.claim("bot-b", 1_001)).toBe(false);
    expect(turn.claim("bot-b", 1_000 + TURN_MS - 1)).toBe(false);
  });

  it("hands the display over once the holder has been quiet long enough", () => {
    const turn = new DesktopScreenTurn(TURN_MS);
    turn.claim("bot-a", 1_000);
    expect(turn.claim("bot-b", 1_000 + TURN_MS)).toBe(true);
    expect(turn.claim("bot-a", 1_000 + TURN_MS + 1)).toBe(false);
  });

  it("keeps the hold while the same bot keeps working", () => {
    const turn = new DesktopScreenTurn(TURN_MS);
    expect(turn.claim("bot-a", 1_000)).toBe(true);
    expect(turn.claim("bot-a", 1_000 + TURN_MS * 4)).toBe(true);
    expect(turn.claim("bot-b", 1_000 + TURN_MS * 4 + 1)).toBe(false);
  });

  it("frees the display on release, and only for the bot that held it", () => {
    const turn = new DesktopScreenTurn(TURN_MS);
    turn.claim("bot-a", 1_000);
    turn.release("bot-b");
    expect(turn.claim("bot-b", 1_001)).toBe(false);
    turn.release("bot-a");
    expect(turn.claim("bot-b", 1_002)).toBe(true);
  });
});
