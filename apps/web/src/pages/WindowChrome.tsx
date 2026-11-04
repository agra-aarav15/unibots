import { useLingui } from "@lingui/react/macro";
import { Minus, Square, X } from "lucide-react";
import { desktopBridge, windowChromeKind } from "../lib/desktop";

/**
 * Window controls for a desktop build whose window has no system frame. They are drawn in
 * the app's own ink rather than copying another platform's colours, and they follow the
 * left-hand order used where this path is reached. macOS and Windows keep their own frames,
 * so this draws nothing there.
 */
export function WindowChrome() {
  const { t } = useLingui();
  const desktop = desktopBridge();
  const kind = windowChromeKind(desktop);
  if (kind === "spacer") {
    return <div className="h-3 w-[72px] shrink-0" aria-hidden="true" />;
  }
  if (kind === "darwin") {
    return <div className="app-drag h-3 w-[72px] shrink-0" aria-hidden="true" />;
  }
  const controls = [
    { label: t`Close`, Icon: X, act: () => desktop?.window.close() },
    { label: t`Minimize`, Icon: Minus, act: () => desktop?.window.minimize() },
    { label: t`Fullscreen`, Icon: Square, act: () => desktop?.window.toggleMaximize() },
  ];
  return (
    <div className="app-drag flex h-3 shrink-0 items-center gap-1">
      {controls.map(({ label, Icon, act }) => (
        <button
          key={label}
          type="button"
          aria-label={label}
          onClick={() => void act()}
          // The row stays one line tall; the targets overflow it so they stay clickable.
          className="app-no-drag -my-1 flex size-5 items-center justify-center rounded-md text-muted-foreground/70 transition hover:bg-accent hover:text-foreground"
        >
          <Icon className="size-3" />
        </button>
      ))}
    </div>
  );
}
