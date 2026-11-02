import { Trans, useLingui } from "@lingui/react/macro";
import { useEffect, useState } from "react";
import { Button } from "@rakazo/ui-web";
import { fetchAuthCapabilities } from "../lib/auth-capabilities";
import { desktopBridge } from "../lib/desktop";
import { SettingsGroup, SettingsRow } from "./SettingsRows";
import { rpc } from "../lib/rpc";
import { errorText } from "../lib/user-error";

function expiryLabel(expiresAt: string, now: number): string {
  const seconds = Math.max(0, Math.round((Date.parse(expiresAt) - now) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * Shows a code a phone on the same network types once. Only the desktop app that runs
 * the local stack can publish the API for a phone, so nothing renders elsewhere.
 */
export function PhoneAccessSection() {
  const { t } = useLingui();
  const bridge = desktopBridge();
  const phoneAccess = bridge?.phoneAccess;
  const [managed, setManaged] = useState(false);
  const [url, setUrl] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!phoneAccess) return;
    let active = true;
    void fetchAuthCapabilities()
      .then((capabilities) => {
        if (active) setManaged(Boolean(capabilities.desktopManaged));
      })
      .catch(() => undefined);
    void phoneAccess
      .state()
      .then((state) => {
        if (active) setUrl(state.url);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [phoneAccess]);

  // Keep the countdown honest for as long as a code is on screen.
  useEffect(() => {
    if (expiresAt === null) return;
    const timer = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(timer);
  }, [expiresAt]);

  if (!phoneAccess || !managed) return null;

  async function connect() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      const enabled = await phoneAccess!.enable();
      if (!enabled.ok) {
        setError(enabled.error);
        return;
      }
      setUrl(enabled.url);
      const pairing = await rpc.pairing.create({ url: enabled.url });
      setCode(pairing.code);
      setExpiresAt(pairing.expiresAt);
    } catch (cause) {
      setError(errorText(cause, t`Could not start phone access`));
    } finally {
      setPending(false);
    }
  }

  async function turnOff() {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await phoneAccess!.disable();
      setUrl(null);
      setCode(null);
      setExpiresAt(null);
    } catch {
      setError(t`Could not turn off phone access`);
    } finally {
      setPending(false);
    }
  }

  return (
    <SettingsGroup title={<Trans>Phone</Trans>}>
      <SettingsRow
        label={<Trans>Phone on this network</Trans>}
        control={
          <Button
            variant="secondary"
            size="sm"
            disabled={pending}
            onClick={() => void (url === null ? connect() : turnOff())}
          >
            {url === null ? <Trans>Turn on</Trans> : <Trans>Turn off</Trans>}
          </Button>
        }
      >
        {url === null && error === null ? null : (
          <div className="mt-3 space-y-1 text-[13px] text-muted-foreground">
            {url === null ? null : <p className="break-all">{url}</p>}
            {code ? (
              <p className="font-mono text-[20px] tracking-[0.3em] text-foreground">{code}</p>
            ) : null}
            {expiresAt ? (
              <p>
                <Trans>Expires in</Trans> {expiryLabel(expiresAt, now)}
              </p>
            ) : null}
            {error ? (
              <p role="alert" className="text-destructive">
                {error}
              </p>
            ) : null}
          </div>
        )}
      </SettingsRow>
    </SettingsGroup>
  );
}