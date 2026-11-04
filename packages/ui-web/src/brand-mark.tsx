import { MARK, MARK_GRADIENT, MARK_STROKE_PATH } from "@rakazo/ui-tokens/mark";
import { useId } from "react";
import { cn } from "./lib/utils.js";

/**
 * The product mark: the gradient "U", drawn from the same geometry in `@rakazo/ui-tokens`
 * that every icon, favicon and splash is rasterised from, so the interface and the artwork
 * cannot drift apart.
 *
 * The viewBox is the inked box of the glyph rather than the full design grid, so the mark
 * carries no dead space and sits optically level with the wordmark beside it.
 */
const INSET = MARK.stroke / 2;
const VIEW_BOX = [
  MARK.bounds.left - INSET,
  MARK.bounds.top - INSET,
  MARK.bounds.right - MARK.bounds.left + MARK.stroke,
  MARK.bounds.bottom - MARK.bounds.top + MARK.stroke,
].join(" ");

export function BrandMark({ className, label }: { className?: string; label?: string }) {
  // A gradient needs an id, and `useId` returns characters that are not valid in a CSS
  // `url(#…)`, so the id is stripped to the safe alphabet before it is referenced.
  const gradientId = `brand-mark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      className={cn("block", className)}
      viewBox={VIEW_BOX}
      role={label ? "img" : undefined}
      aria-label={label}
      aria-hidden={label ? undefined : true}
    >
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
        d={MARK_STROKE_PATH}
        fill="none"
        stroke={`url(#${gradientId})`}
        strokeWidth={MARK.stroke}
        strokeLinecap="round"
      />
    </svg>
  );
}

/**
 * The mark with the product name. Sizes are passed in rather than baked, because the
 * signed-out hero sets it far larger than the app's own chrome does.
 */
export function Wordmark({
  className,
  markClassName,
  textClassName,
}: {
  className?: string;
  markClassName?: string;
  textClassName?: string;
}) {
  return (
    <span className={cn("flex items-center gap-3", className)}>
      <BrandMark className={cn("h-10 w-auto", markClassName)} />
      <span className={cn("text-[28px] leading-none tracking-tight text-foreground", textClassName)}>
        Unibots
      </span>
    </span>
  );
}
