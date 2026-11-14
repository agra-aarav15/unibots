// @vitest-environment jsdom

import { beforeEach, describe, expect, it } from "vitest";
import { lastQueryUser, rememberQueryUser } from "./last-user";

beforeEach(() => {
  localStorage.clear();
});

describe("the last user this browser ran as", () => {
  it("remembers and forgets an identifier", () => {
    rememberQueryUser("user-1");
    expect(lastQueryUser()).toBe("user-1");
    expect(localStorage.getItem("unibot.lastUser")).toBe("user-1");
    rememberQueryUser(null);
    expect(lastQueryUser()).toBeNull();
  });

  // The key was renamed with the product. An existing install still holds the old one, and reading
  // only the new name would make every reload start cold even though the cached space is right there.
  it("carries an identifier saved under the old name forward, once", () => {
    localStorage.setItem("rakazo.lastUser", "user-2");
    expect(lastQueryUser()).toBe("user-2");
    expect(localStorage.getItem("unibot.lastUser")).toBe("user-2");
    expect(localStorage.getItem("rakazo.lastUser")).toBeNull();
  });

  it("prefers the current name when both are present", () => {
    localStorage.setItem("unibot.lastUser", "user-3");
    localStorage.setItem("rakazo.lastUser", "user-2");
    expect(lastQueryUser()).toBe("user-3");
    expect(localStorage.getItem("rakazo.lastUser")).toBe("user-2");
  });

  it("starts cold when nothing was saved", () => {
    expect(lastQueryUser()).toBeNull();
  });

  it("clears the old name when an identifier is remembered", () => {
    localStorage.setItem("rakazo.lastUser", "user-2");
    rememberQueryUser("user-4");
    expect(localStorage.getItem("rakazo.lastUser")).toBeNull();
    expect(lastQueryUser()).toBe("user-4");
  });
});
