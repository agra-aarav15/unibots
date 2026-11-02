import type { NetworkInterfaceInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { lanIpv4, lanUrl } from "./phone-access.js";

function entry(address: string, family: "IPv4" | "IPv6", internal = false): NetworkInterfaceInfo {
  return { address, netmask: "", family, mac: "", internal, cidr: null } as NetworkInterfaceInfo;
}

describe("lanIpv4", () => {
  it("picks the first private IPv4 address a phone can reach", () => {
    expect(
      lanIpv4({
        lo: [entry("127.0.0.1", "IPv4", true)],
        eth0: [entry("fe80::1", "IPv6"), entry("192.168.1.24", "IPv4")],
      }),
    ).toBe("192.168.1.24");
  });

  it("skips loopback, internal and link-local addresses", () => {
    expect(lanIpv4({ lo: [entry("127.0.0.1", "IPv4", true)] })).toBeNull();
    expect(lanIpv4({ eth0: [entry("169.254.10.4", "IPv4")] })).toBeNull();
    expect(lanIpv4({})).toBeNull();
  });
});

describe("lanUrl", () => {
  it("builds a plain HTTP address for a private network", () => {
    expect(lanUrl("192.168.1.24", 3100)).toBe("http://192.168.1.24:3100");
    expect(lanUrl("fd00::5", 3100)).toBe("http://[fd00::5]:3100");
  });
});
