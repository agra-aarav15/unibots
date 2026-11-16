import { t } from "@lingui/core/macro";
import { Trans } from "@lingui/react/macro";
import type { ComputerScreenFrame, ComputerStatus } from "@unibot/contracts";
import { useEffect, useState } from "react";
import { rpc } from "../../lib/rpc";

export function DesktopKindEmptyState({ className }: { className?: string }) {
  return (
    <div className={className}>
      <Trans>
        This bot runs on this computer, not a Linux desktop. Shell and files use your home folder.
      </Trans>
    </div>
  );
}

/** How often the viewer asks for the next frame while it is on screen. */
export const LIVE_SCREEN_INTERVAL_MS = 1_200;

/**
 * The local computer's own screen, live, while the viewer is open. It asks for one frame at a time
 * so slow captures never queue up, and a hidden tab stops asking until it is shown again.
 */
export function LocalScreen({ botId, alt }: { botId: string; alt: string }) {
  const [frame, setFrame] = useState<ComputerScreenFrame | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (alive && !document.hidden) {
        try {
          const next = await rpc.computer.screenFrame({ botId });
          if (!alive) return;
          setFrame(next);
          setFailed(false);
        } catch {
          if (!alive) return;
          setFailed(true);
        }
      }
      if (alive) timer = setTimeout(tick, LIVE_SCREEN_INTERVAL_MS);
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [botId]);

  if (!frame || failed)
    return (
      <DesktopKindEmptyState className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80" />
    );
  return (
    <img
      src={`data:${frame.mimeType};base64,${frame.image}`}
      alt={alt}
      draggable={false}
      className="h-full w-full bg-black object-contain"
    />
  );
}

export function computerPlaceholder(
  state: ComputerStatus["state"] | undefined,
  booting: boolean,
  label: string,
) {
  if (state === "booting" || booting) return t`Booting live desktop…`;
  if (state === "running") return label;
  if (state === "suspended") return t`Computer is asleep. Open it to wake.`;
  if (state === "error") return t`Computer failed to boot`;
  return t`Computer is stopped`;
}

export function computerLabel(mode: ComputerStatus["mode"] | undefined, botName: string) {
  return mode === "dedicated" ? t`${botName}’s computer` : t`Team Computer`;
}
