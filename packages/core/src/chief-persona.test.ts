import { describe, expect, it } from "vitest";
import { CHIEF_GROK_INSTRUCTIONS, defaultBotInstructions } from "./chief-persona.js";

describe("defaultBotInstructions", () => {
  it("starts a bot with no instructions on the default persona", () => {
    expect(defaultBotInstructions("")).toBe(CHIEF_GROK_INSTRUCTIONS);
    expect(defaultBotInstructions(undefined)).toBe(CHIEF_GROK_INSTRUCTIONS);
    expect(defaultBotInstructions("   \n ")).toBe(CHIEF_GROK_INSTRUCTIONS);
  });

  it("keeps instructions the owner wrote, whitespace and all", () => {
    expect(defaultBotInstructions("  You are Scout.  ")).toBe("  You are Scout.  ");
  });
});
