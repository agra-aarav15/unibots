import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearSpace, normalizeApiBase, saveApiBase } from "./api";
import { pairWithComputer, pairingUrlAllowed } from "./pair-device";
import { saveSessionToken } from "./session";

vi.mock("./api", () => ({
  normalizeApiBase: vi.fn(),
  saveApiBase: vi.fn(),
  clearSpace: vi.fn(),
}));
vi.mock("./session", () => ({ saveSessionToken: vi.fn() }));
vi.mock("./user-error", () => ({ errorText: (text: string) => text }));

const normalize = vi.mocked(normalizeApiBase);
const saveBase = vi.mocked(saveApiBase);
const clear = vi.mocked(clearSpace);
const saveToken = vi.mocked(saveSessionToken);

const PRIVATE_URL = "http://192.168.1.24:3100";

beforeEach(() => {
  normalize.mockReturnValue({ ok: true, url: PRIVATE_URL });
  saveBase.mockResolvedValue({ ok: true, url: PRIVATE_URL });
  clear.mockResolvedValue(true);
  saveToken.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

describe("pairingUrlAllowed", () => {
  it("accepts HTTPS anywhere and plain HTTP only on a private or loopback address", () => {
    expect(pairingUrlAllowed("https://home.example.com")).toBe(true);
    expect(pairingUrlAllowed("http://192.168.1.24:3100")).toBe(true);
    expect(pairingUrlAllowed("http://10.0.0.5:3100")).toBe(true);
    expect(pairingUrlAllowed("http://127.0.0.1:3100")).toBe(true);
    expect(pairingUrlAllowed("http://localhost:3100")).toBe(true);
  });

  it("refuses a public HTTP address, credentials, and other schemes", () => {
    expect(pairingUrlAllowed("http://app.example.com")).toBe(false);
    expect(pairingUrlAllowed("http://user:pass@192.168.1.24:3100")).toBe(false);
    expect(pairingUrlAllowed("file:///etc/passwd")).toBe(false);
    expect(pairingUrlAllowed("not a url")).toBe(false);
  });
});

describe("pairWithComputer", () => {
  it("stores the returned address and token after clearing the previous account", async () => {
    const fetchMock = vi.fn(async () =>
      Response.json({
        json: { token: "session-token", apiUrl: PRIVATE_URL, spaceId: "ws-1" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pairWithComputer({
        url: "192.168.1.24:3100",
        code: "123456",
        deviceName: "Phone",
        platform: "android",
      }),
    ).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith(
      `${PRIVATE_URL}/rpc/device/pair`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          json: { code: "123456", deviceName: "Phone", platform: "android" },
        }),
      }),
    );
    expect(saveBase).toHaveBeenCalledWith(PRIVATE_URL);
    expect(clear).toHaveBeenCalled();
    expect(saveToken).toHaveBeenCalledWith("session-token");
  });

  it("does not send a code that is not six digits", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pairWithComputer({
        url: PRIVATE_URL,
        code: "12345",
        deviceName: "Phone",
        platform: "ios",
      }),
    ).resolves.toEqual({ ok: false, error: "Enter the 6-digit code from the computer." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("refuses a public HTTP address before sending the code", async () => {
    normalize.mockReturnValue({ ok: true, url: "http://app.example.com" });
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      pairWithComputer({
        url: "http://app.example.com",
        code: "123456",
        deviceName: "Phone",
        platform: "android",
      }),
    ).resolves.toMatchObject({ ok: false });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("shows the generic server error without saving a session", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ json: { message: "That code is not valid. Start again." } }, { status: 400 }),
      ),
    );

    await expect(
      pairWithComputer({
        url: PRIVATE_URL,
        code: "123456",
        deviceName: "Phone",
        platform: "android",
      }),
    ).resolves.toEqual({ ok: false, error: "That code is not valid. Start again." });
    expect(saveBase).not.toHaveBeenCalled();
    expect(saveToken).not.toHaveBeenCalled();
  });

  it("refuses a successful response without a token", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ json: { apiUrl: PRIVATE_URL } })),
    );

    await expect(
      pairWithComputer({
        url: PRIVATE_URL,
        code: "123456",
        deviceName: "Phone",
        platform: "android",
      }),
    ).resolves.toEqual({
      ok: false,
      error: "The computer did not return a session. Try again.",
    });
    expect(saveToken).not.toHaveBeenCalled();
  });

  it("reports a failure to save the address", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ json: { token: "session-token", apiUrl: PRIVATE_URL } }),
      ),
    );
    saveBase.mockResolvedValue({ ok: false, error: "Could not save the address." });

    await expect(
      pairWithComputer({
        url: PRIVATE_URL,
        code: "123456",
        deviceName: "Phone",
        platform: "android",
      }),
    ).resolves.toEqual({ ok: false, error: "Could not save the address." });
    expect(saveToken).not.toHaveBeenCalled();
  });
});
