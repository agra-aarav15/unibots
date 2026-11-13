import { useEffect, useState } from "react";
import { fetchAuthCapabilities } from "./auth-capabilities";

/**
 * The owner of a machine running in `AUTH_MODE=local`. The server names them in its public
 * capabilities, so the app can open without a session, a sign-in screen, or an account.
 */
export type LocalOwner = { id: string; name: string; email: string };

let resolved: LocalOwner | null | undefined;

export function useLocalOwner(): LocalOwner | null {
  const [owner, setOwner] = useState<LocalOwner | null>(resolved ?? null);
  useEffect(() => {
    if (resolved !== undefined) {
      setOwner(resolved);
      return;
    }
    let alive = true;
    void fetchAuthCapabilities().then(
      (capabilities) => {
        resolved = capabilities.localOwner ?? null;
        if (alive) setOwner(resolved);
      },
      () => {
        // A server that cannot say is treated as an ordinary one: the session decides.
        resolved = null;
        if (alive) setOwner(null);
      },
    );
    return () => {
      alive = false;
    };
  }, []);
  return owner;
}

/** The session user shape these screens read, filled from the owner for a local server. */
export function localOwnerUser(owner: LocalOwner): {
  id: string;
  name: string;
  email: string;
  emailVerified: true;
  image: null;
} {
  return { id: owner.id, name: owner.name, email: owner.email, emailVerified: true, image: null };
}