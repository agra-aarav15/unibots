// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { clearLegacyKey, migrateLegacyKeyPrefix, readMigratedKey } from "./legacy-storage";

beforeEach(() => {
  localStorage.clear();
});

describe("renamed storage keys carry a saved value forward", () => {
  it("moves the value under the old name to the new one, once", () => {
    localStorage.setItem("rakazo.renamed", "kept");
    expect(readMigratedKey(localStorage, "unibot.renamed", "rakazo.renamed")).toBe("kept");
    expect(localStorage.getItem("unibot.renamed")).toBe("kept");
    expect(localStorage.getItem("rakazo.renamed")).toBeNull();
  });

  it("prefers the current name and leaves the old one alone", () => {
    localStorage.setItem("unibot.renamed", "new");
    localStorage.setItem("rakazo.renamed", "old");
    expect(readMigratedKey(localStorage, "unibot.renamed", "rakazo.renamed")).toBe("new");
    expect(localStorage.getItem("rakazo.renamed")).toBe("old");
  });

  it("starts cold when nothing was saved", () => {
    expect(readMigratedKey(localStorage, "unibot.renamed", "rakazo.renamed")).toBeNull();
  });

  it("clears the old name once the new one is written", () => {
    localStorage.setItem("rakazo.renamed", "old");
    localStorage.setItem("unibot.renamed", "new");
    clearLegacyKey(localStorage, "rakazo.renamed");
    expect(localStorage.getItem("rakazo.renamed")).toBeNull();
    expect(localStorage.getItem("unibot.renamed")).toBe("new");
  });

  it("moves every entry saved under a renamed prefix", () => {
    localStorage.setItem("rakazo.draft.bot:1", "hello");
    localStorage.setItem("rakazo.draft.group:2", "hi");
    localStorage.setItem("unibot.draft.bot:3", "current");
    migrateLegacyKeyPrefix(localStorage, "unibot.draft.", "rakazo.draft.");
    expect(localStorage.getItem("unibot.draft.bot:1")).toBe("hello");
    expect(localStorage.getItem("unibot.draft.group:2")).toBe("hi");
    expect(localStorage.getItem("unibot.draft.bot:3")).toBe("current");
    expect(localStorage.getItem("rakazo.draft.bot:1")).toBeNull();
  });
});
