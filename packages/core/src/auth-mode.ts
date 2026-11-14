/**
 * `AUTH_MODE=local`: the machine this server runs on is the identity, so nobody signs in.
 *
 * The server, the worker and the run path all ask this question and must answer it the same way.
 * Comparing the raw string in each place meant `AUTH_MODE=Local` gave the server a cookie-less
 * session while the run path still refused that same session a model on a private address.
 */
export function isLocalAuthMode(value: string | undefined): boolean {
  return value?.trim().toLowerCase() === "local";
}