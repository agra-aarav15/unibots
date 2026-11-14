// @vitest-environment jsdom

import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray) => parts.join("");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@unibot/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
}));

import { CliKeyControls } from "./connection-controls";

type Props = Parameters<typeof CliKeyControls>[0];

const saved: NonNullable<Props["credential"]> = {
  id: "credential-fixture",
  provider: "local-cli",
  label: "Command line",
  hasKey: false,
  isDefault: true,
};

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
});

function props(overrides: Partial<Props> = {}): Props {
  return {
    busy: false,
    cliReady: true,
    connectKey: vi.fn(async () => {}),
    credential: undefined,
    isCli: true,
    pending: null,
    ...overrides,
  };
}

async function render(input: Props) {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => {
    root.render(<CliKeyControls {...input} />);
  });
  return { container, root };
}

function button(container: HTMLElement) {
  return container.querySelector("button");
}

// The regression this guards: the panel used to gate its only button on a saved connection being
// edited, so a command-line connection could never be created from the screen at all.
it("offers a way to connect a command-line model that does not exist yet", async () => {
  const input = props();
  const { container } = await render(input);
  const connect = button(container);
  expect(connect?.textContent).toBe("Connect");
  expect(connect?.disabled).toBe(false);
  await act(async () => connect?.click());
  expect(input.connectKey).toHaveBeenCalledWith({});
});

it("keeps the button in place but out of reach until the command and model are filled in", async () => {
  const { container } = await render(props({ cliReady: false }));
  expect(button(container)?.textContent).toBe("Connect");
  expect(button(container)?.disabled).toBe(true);
});

it("saves an existing connection without asking for its command again", async () => {
  const input = props({ credential: saved });
  const { container } = await render(input);
  const save = button(container);
  expect(save?.textContent).toBe("Save");
  await act(async () => save?.click());
  expect(input.connectKey).toHaveBeenCalledWith({ settingsOnly: true });
});

it("shows progress while saving and stays out of reach then", async () => {
  const { container } = await render(props({ busy: true, pending: "connect" }));
  expect(button(container)?.textContent).toBe("Saving...");
  expect(button(container)?.disabled).toBe(true);
});

it("renders nothing for a provider that is not a command line", async () => {
  const { container } = await render(props({ isCli: false }));
  expect(container.textContent).toBe("");
});
