/**
 * One physical display, several bots: whoever is acting on it holds it until they stop. The hold
 * also expires on its own, so a bot that dies mid-run cannot lock the screen out of everyone's
 * reach. Reads are not gated — looking at a shared screen costs nobody anything.
 */
export class DesktopScreenTurn {
  private holder: { key: string; at: number } | undefined;

  constructor(private readonly holdMs: number) {}

  /** Takes the display for this key, or reports that another key is still using it. */
  claim(key: string, now = Date.now()): boolean {
    const holder = this.holder;
    if (holder && holder.key !== key && now - holder.at < this.holdMs) return false;
    this.holder = { key, at: now };
    return true;
  }

  /** Frees the display for whoever held it. Another key's release is ignored. */
  release(key: string): void {
    if (this.holder?.key === key) this.holder = undefined;
  }
}
