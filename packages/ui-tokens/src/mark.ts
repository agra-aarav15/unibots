/**
 * The Unibots mark, defined once as geometry.
 *
 * Every icon, favicon, splash, installer plate, and notification silhouette is
 * rasterised from these values, so a single edit updates the whole product.
 * The shapes are drawn from scratch here: no upstream artwork, photograph, font,
 * or traced outline is loaded or embedded.
 *
 * Design: a continuous "U" of constant weight with round terminals on a rounded
 * plate. The U alone stays legible from a 16 px favicon up to the installer, and
 * it needs no eyes or extra accents that would turn to mush when small.
 */

/** Geometry on the 1024 px design grid. */
export const MARK = {
  /** The plate covers 64..960 so exported icons keep a small optical margin. */
  plate: { inset: 64, radius: 220 },
  /** Centre lines of the U. Both stems share this stroke. */
  stroke: 148,
  /** Horizontal centre of each stem. */
  left: 350,
  right: 674,
  /** Y where the round stem terminals begin. */
  top: 278,
  /** Y of the bowl's centre; the semicircle closes the two stems here. */
  bowl: 584,
  /** Radius of the bowl, exactly half the gap between the stems. */
  bowlRadius: 162,
  /** Visible bounds of the glyph, used to centre it inside a mask or splash. */
  bounds: { left: 276, top: 204, right: 748, bottom: 820 },
} as const;

/** Warm coral at the crown, violet at the bowl: warmth up top, depth below. */
export const MARK_GRADIENT = [
  { offset: 0, color: "#ff7a30" },
  { offset: 0.5, color: "#ec4899" },
  { offset: 1, color: "#6366f1" },
] as const;

const STEMS = `M ${MARK.left} ${MARK.top} L ${MARK.left} ${MARK.bowl} A ${MARK.bowlRadius} ${MARK.bowlRadius} 0 0 0 ${MARK.right} ${MARK.bowl} L ${MARK.right} ${MARK.top}`;

function gradient(
  id: string,
  stops: readonly { offset: number; color: string }[],
  vertical: { y1: number; y2: number } = { y1: MARK.bounds.top, y2: MARK.bounds.bottom },
): string {
  return `<linearGradient id="${id}" gradientUnits="userSpaceOnUse" x1="0" y1="${vertical.y1}" x2="0" y2="${vertical.y2}">${stops
    .map((stop) => `<stop offset="${stop.offset}" stop-color="${stop.color}"/>`)
    .join("")}</linearGradient>`;
}

/** The U on transparency, painted with the brand gradient. */
export function glyphSvg(size = 1024, padding = 0): string {
  const view = 1024 + padding * 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="${-padding} ${-padding} ${view} ${view}"><defs>${gradient(
    "g",
    MARK_GRADIENT,
  )}</defs><path d="${STEMS}" fill="none" stroke="url(#g)" stroke-width="${MARK.stroke}" stroke-linecap="round"/></svg>`;
}

/** The U plus the rounded plate behind it, for app icons and installer art. */
export function plateSvg(size = 1024, plateColor = "#101218"): string {
  const { inset, radius } = MARK.plate;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><defs>${gradient(
    "g",
    MARK_GRADIENT,
  )}</defs><rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${radius}" ry="${radius}" fill="${plateColor}"/><path d="${STEMS}" fill="none" stroke="url(#g)" stroke-width="${MARK.stroke}" stroke-linecap="round"/></svg>`;
}

/** Flat white U on transparency, for themed launchers and status bars. */
export function monoMarkSvg(size = 1024): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><path d="${STEMS}" fill="none" stroke="#ffffff" stroke-width="${MARK.stroke}" stroke-linecap="round"/></svg>`;
}

/**
 * The mark on a plate tinted to one role's colour, used for the marketing roster.
 * Lightening and darkening the same hue keeps a team of eight readable as one family.
 */
export function rosterMarkSvg(color: string, size = 384): string {
  const { inset, radius } = MARK.plate;
  const stops = [
    { offset: 0, color: lighten(color, 0.18) },
    { offset: 0.55, color },
    { offset: 1, color: darken(color, 0.22) },
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><defs>${gradient(
    "g",
    stops,
  )}</defs><rect x="${inset}" y="${inset}" width="${1024 - inset * 2}" height="${1024 - inset * 2}" rx="${radius}" ry="${radius}" fill="${color}"/><path d="${STEMS}" fill="none" stroke="url(#g)" stroke-width="${MARK.stroke}" stroke-linecap="round"/><path d="${STEMS}" fill="none" stroke="#ffffff" stroke-opacity="0.55" stroke-width="${MARK.stroke - 26}" stroke-linecap="round"/></svg>`;
}

function rgb(hex: string): [number, number, number] {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  return [1, 3, 5].map((i) => Number.parseInt(full.slice(i, i + 2), 16)) as [
    number,
    number,
    number,
  ];
}

function shift(hex: string, amount: number): string {
  const toward = amount > 0 ? 255 : 0;
  return `#${rgb(hex)
    .map((value) =>
      Math.round(value + (toward - value) * Math.abs(amount))
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

export function lighten(hex: string, amount: number): string {
  return shift(hex, amount);
}

export function darken(hex: string, amount: number): string {
  return shift(hex, -amount);
}

/** The solid plate colour, for Android's separate background layer. */
export const MARK_PLATE_COLOR = "#101218";

/** Android adaptive icons crop to a circle/squircle, so keep the glyph inside 72%. */
export function adaptiveGlyphSvg(size = 1024): string {
  const inset = 160;
  const view = 1024 - inset * 2;
  const scale = view / 1024;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 1024 1024"><g transform="translate(${inset} ${inset}) scale(${scale})"><svg width="1024" height="1024" viewBox="0 0 1024 1024"><defs>${gradient(
    "g",
    MARK_GRADIENT,
  )}</defs><path d="${STEMS}" fill="none" stroke="url(#g)" stroke-width="${MARK.stroke}" stroke-linecap="round"/></svg></g></svg>`;
}

/**
 * The SVG path used by the animated in-app avatar.
 *
 * The avatar draws a filled body, so it strokes this path for its silhouette
 * instead of re-tracing an outline. Exported separately so the renderer and the
 * icon export cannot drift apart.
 */
export const MARK_STROKE_PATH = STEMS;