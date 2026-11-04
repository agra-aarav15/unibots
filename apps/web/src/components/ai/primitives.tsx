import { MARK, MARK_GRADIENT, MARK_STROKE_PATH } from "@rakazo/ui-tokens/mark";
import { cn } from "@rakazo/ui-web";
import { useEffect, useId, useState } from "react";
import "./ai-motion.css";

/* The waiting and completion beats. Both are drawn from the product's own mark: the moment
   a bot is working is the one moment the interface is allowed to show its gradient. */

/** Centreline length of the mark, so the draw animation fits whatever the geometry becomes. */
const MARK_PATH_LENGTH = 2 * (MARK.bowl - MARK.top) + Math.PI * MARK.bowlRadius;

const MARK_VIEW_BOX = [
  MARK.bounds.left - MARK.stroke / 2,
  MARK.bounds.top - MARK.stroke / 2,
  MARK.bounds.right - MARK.bounds.left + MARK.stroke,
  MARK.bounds.bottom - MARK.bounds.top + MARK.stroke,
].join(" ");

/** The mark, drawing itself on and away again, in the product's gradient. */
function WorkingMark() {
  const gradientId = `working-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg className="h-5 w-auto shrink-0" viewBox={MARK_VIEW_BOX} aria-hidden="true">
      <defs>
        <linearGradient
          id={gradientId}
          gradientUnits="userSpaceOnUse"
          x1="0"
          y1={MARK.bounds.top}
          x2="0"
          y2={MARK.bounds.bottom}
        >
          {MARK_GRADIENT.map((stop) => (
            <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />
          ))}
        </linearGradient>
      </defs>
      <path
        className="rk-working-mark"
        d={MARK_STROKE_PATH}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={MARK.stroke}
        strokeLinecap="round"
        strokeDasharray={`${MARK_PATH_LENGTH} ${MARK_PATH_LENGTH}`}
        style={{ "--rk-mark-length": MARK_PATH_LENGTH } as React.CSSProperties}
      />
    </svg>
  );
}

/** A light sweep travelling across a text label. */
export function Shimmer({ children }: { children: React.ReactNode }) {
  return (
    <span className="rk-shimmer bg-linear-to-r from-muted-foreground from-35% via-foreground via-50% to-muted-foreground to-65% bg-size-[200%_100%] bg-clip-text text-transparent">
      {children}
    </span>
  );
}

/** Format wall-clock seconds since `startedAtMs` as `0.0s` / `1m 2.3s`. */
export function formatElapsed(startedAtMs: number, nowMs: number): string {
  const totalTenths = Math.round(Math.max(0, nowMs - startedAtMs) / 100);
  const minutes = Math.floor(totalTenths / 600);
  const seconds = (totalTenths % 600) / 10;
  if (minutes === 0) return `${seconds.toFixed(1)}s`;
  return `${minutes}m ${seconds.toFixed(1)}s`;
}

function useElapsed(startedAtMs?: number): string {
  const [mountedAt] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(timer);
  }, []);
  return formatElapsed(startedAtMs ?? mountedAt, now);
}

/** The mark drawing itself, a shimmering label and a live elapsed timer. */
function DefaultLoadingState({ label, startedAt }: { label: string; startedAt?: number }) {
  const elapsed = useElapsed(startedAt);
  return (
    <>
      <WorkingMark />
      <span className="text-[13.5px] font-medium">
        <Shimmer>{label}</Shimmer>
      </span>
      <span className="font-mono text-[12px] tabular-nums text-muted-foreground">{elapsed}</span>
    </>
  );
}

export function LoadingState({
  indicator,
  label = "working",
  startedAt,
}: {
  indicator?: React.ReactNode;
  label?: string;
  /** Epoch ms when the run started. Falls back to mount time when omitted. */
  startedAt?: number;
}) {
  if (indicator) {
    return (
      <span role="status" className="flex w-fit items-center gap-2.5">
        <span className="sr-only">{label}</span>
        {indicator}
      </span>
    );
  }
  return (
    <span className="flex w-fit items-center gap-2.5">
      <DefaultLoadingState label={label} startedAt={startedAt} />
    </span>
  );
}

/** Pop-in check with a fading-up label, used wherever a step has just completed. */
export function SuccessPop({ label }: { label: string }) {
  return (
    <span className="flex items-center gap-2">
      <span className="rk-check-pop flex h-6 w-6 items-center justify-center rounded-full bg-success text-background">
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="3"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <path d="M20 6L9 17l-5-5" />
        </svg>
      </span>
      <span className="rk-fade-up text-[13px] font-medium text-foreground">{label}</span>
    </span>
  );
}

/** Card shell for every card in the chat. */
export function CardShell({ className, ...props }: React.ComponentPropsWithoutRef<"div">) {
  return <div {...props} className={cn("rounded-[20px] bg-card", className)} />;
}
