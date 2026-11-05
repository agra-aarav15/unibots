// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  spaces: {
    members: vi.fn(),
    invitations: vi.fn(),
    invite: vi.fn(),
    revokeInvitation: vi.fn(),
    setMemberRole: vi.fn(),
    removeMember: vi.fn(),
  },
}));
vi.mock("../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => "space-a",
}));
vi.mock("../lib/space-rpc", () => ({
  useSpaceRpc: () => api,
  useBoundSpaceId: () => "space-a",
}));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@rakazo/ui-web", () => {
  const Box = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return {
    Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
    Input: (props: ComponentProps<"input">) => <input {...props} />,
    Dialog: Box,
    DialogContent: Box,
    DialogDescription: Box,
    DialogHeader: Box,
    DialogTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  };
});

import { SpaceMembersPanel } from "./SpaceMembersPanel";

const owner = {
  userId: "user-owner",
  name: "Owner",
  email: "owner@example.test",
  role: "owner" as const,
  createdAt: "2026-01-01T00:00:00.000Z",
  isSelf: true,
};
const teammate = {
  userId: "user-2",
  name: "Teammate",
  email: "teammate@example.test",
  role: "member" as const,
  createdAt: "2026-01-02T00:00:00.000Z",
  isSelf: false,
};
const member = { ...teammate, isSelf: true };

let container: HTMLDivElement;
let root: ReturnType<typeof createRoot>;
let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  api.spaces.members.mockReset();
  api.spaces.invitations.mockReset();
  api.spaces.invite.mockReset();
  api.spaces.revokeInvitation.mockReset();
  api.spaces.setMemberRole.mockReset();
  api.spaces.removeMember.mockReset();
  api.spaces.invitations.mockResolvedValue([]);
  api.spaces.members.mockResolvedValue([owner]);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

async function render() {
  await act(async () => {
    root.render(
      <QueryClientProvider client={client}>
        <SpaceMembersPanel spaceId="space-a" />
      </QueryClientProvider>,
    );
  });
  // Two passes: the roster decides whether an owner's pending links are read at all.
  for (let pass = 0; pass < 2; pass += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

function buttons() {
  return [...container.querySelectorAll("button")];
}
function button(label: string) {
  return buttons().find(
    (item) => item.textContent === label || item.getAttribute("aria-label") === label,
  );
}

describe("SpaceMembersPanel", () => {
  it("shows the roster to every member and offers an owner a link to hand out", async () => {
    api.spaces.members.mockResolvedValue([owner, teammate]);
    await render();
    expect(container.textContent).toContain("Owner");
    expect(container.textContent).toContain("Member");
    expect(button("Create a link")).toBeTruthy();
  });

  it("offers a plain member neither the roster controls nor an invite", async () => {
    api.spaces.members.mockResolvedValue([{ ...owner, isSelf: false }, member]);
    await render();
    expect(container.textContent).toContain("Owner");
    expect(button("Create a link")).toBeUndefined();
    expect(button("Remove")).toBeUndefined();
    // The owner's row is not theirs to change, so no controls appear at all.
    expect(button("Make member")).toBeUndefined();
    // A member never reads invitations, which only an owner may list.
    expect(api.spaces.invitations).not.toHaveBeenCalled();
  });

  it("makes a teammate an owner from the roster", async () => {
    api.spaces.members.mockResolvedValue([owner, teammate]);
    api.spaces.setMemberRole.mockResolvedValue({ ok: true });
    await render();
    await act(async () => button("Make owner")?.click());
    expect(api.spaces.setMemberRole).toHaveBeenCalledWith({
      spaceId: "space-a",
      memberUserId: "user-2",
      role: "owner",
    });
  });

  it("builds a link, shows it, and copies the sign-up address", async () => {
    api.spaces.invite.mockResolvedValue({
      id: "invite-1",
      email: "teammate@example.test",
      role: "member",
      token: "tok_123",
      expiresAt: "2026-01-09T00:00:00.000Z",
      createdAt: "2026-01-02T00:00:00.000Z",
    });
    await render();
    await act(async () => button("Create a link")?.click());
    // Naming an address binds the link to it, so the request carries it.
    const field = container.querySelector("input")!;
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      setValue.call(field, "teammate@example.test");
      field.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => button("Create link")?.click());
    expect(api.spaces.invite).toHaveBeenCalledWith({
      spaceId: "space-a",
      email: "teammate@example.test",
    });
    expect(container.querySelector("input")?.value).toBe(
      `${window.location.origin}/sign-up?invite=tok_123`,
    );
  });

  it("offers to revoke a pending link", async () => {
    api.spaces.members.mockResolvedValue([owner]);
    api.spaces.invitations.mockResolvedValue([
      {
        id: "invite-1",
        email: null,
        role: "member",
        token: "tok_123",
        expiresAt: "2026-01-09T00:00:00.000Z",
        createdAt: "2026-01-02T00:00:00.000Z",
      },
    ]);
    api.spaces.revokeInvitation.mockResolvedValue({ ok: true });
    await render();
    expect(container.textContent).toContain("Anyone with the link");
    await act(async () => button("Revoke")?.click());
    expect(api.spaces.revokeInvitation).toHaveBeenCalledWith({
      spaceId: "space-a",
      invitationId: "invite-1",
    });
  });
});
