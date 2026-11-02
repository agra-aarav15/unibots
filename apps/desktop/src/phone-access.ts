import type { NetworkInterfaceInfo } from "node:os";

/** Default private-network port; 3100 matches the API's container port. */
export const DEFAULT_LAN_PORT = 3100;

/**
 * The first private IPv4 address a phone on the same network can reach. Link-local
 * (169.254/16) addresses are skipped: they usually mean no DHCP lease, not a network.
 */
export function lanIpv4(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]>): string | null {
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family !== "IPv4" || entry.internal) continue;
      if (entry.address.startsWith("169.254.")) continue;
      return entry.address;
    }
  }
  return null;
}

/** An address a phone can open; private LAN access is plain HTTP by design. */
export function lanUrl(host: string, port: number): string {
  return `http://${host.includes(":") ? `[${host}]` : host}:${port}`;
}
