// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { LIVE_SCREEN_INTERVAL_MS, LocalScreen } from "./computer-view";

const frame = vi.hoisted(() => vi.fn());
vi.mock("../../lib/rpc", () => ({ rpc: { computer: { screenFrame: frame } } }));
vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({ t: (strings: TemplateStringsArray) => strings.join("") }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));

const png = "iVBORw0KGgo=";
const observed = {
  image: png,
  mimeType: "image/png" as const,
  width: 1_920,
  height: 1_080,
  capturedAt: "2026-11-16T00:00:00.000Z",
};

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  frame.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.useRealTimers();
});

async function show() {
  await act(async () => {
    root.render(<LocalScreen botId="bot-1" alt="Bot screen" />);
  });
}

async function nextFrame() {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(LIVE_SCREEN_INTERVAL_MS);
  });
}

it("shows the computer's own screen once a frame arrives", async () => {
  frame.mockResolvedValue(observed);
  await show();
  const image = container.querySelector("img");
  expect(frame).toHaveBeenCalledWith({ botId: "bot-1" });
  expect(image?.getAttribute("src")).toBe(`data:image/png;base64,${png}`);
  expect(image?.getAttribute("alt")).toBe("Bot screen");
});

it("keeps the written explanation while the computer has no screen to show", async () => {
  frame.mockResolvedValue(null);
  await show();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("not a Linux desktop");
});

it("falls back to that explanation when a frame fails instead of showing a broken image", async () => {
  frame.mockRejectedValue(new Error("computer unavailable"));
  await show();
  expect(container.querySelector("img")).toBeNull();
  expect(container.textContent).toContain("not a Linux desktop");
});

it("asks one frame at a time and stops asking once it is gone", async () => {
  vi.useFakeTimers();
  frame.mockResolvedValue(observed);
  await show();
  expect(frame).toHaveBeenCalledTimes(1);
  await nextFrame();
  expect(frame).toHaveBeenCalledTimes(2);
  act(() => root.unmount());
  await nextFrame();
  expect(frame).toHaveBeenCalledTimes(2);
});

it("stops asking while the tab is hidden and picks up again when it is shown", async () => {
  vi.useFakeTimers();
  frame.mockResolvedValue(observed);
  let hidden = true;
  Object.defineProperty(document, "hidden", { configurable: true, get: () => hidden });
  try {
    await show();
    expect(frame).not.toHaveBeenCalled();
    await nextFrame();
    expect(frame).not.toHaveBeenCalled();
    hidden = false;
    await nextFrame();
    expect(frame).toHaveBeenCalledTimes(1);
  } finally {
    delete (document as { hidden?: boolean }).hidden;
  }
});
