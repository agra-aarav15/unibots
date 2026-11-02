/**
 * The bot head, drawn as one symmetric outline: a flat crown, straight sides with
 * soft shoulders, and a broad base. It is deliberately not a dome-and-hem
 * silhouette, so the avatar reads as a device rather than a floating figure.
 *
 * Coordinates live in the avatar's 100x110 user space; the eyes sit at y=49 and the
 * book/monitor at y=75..94, so the body must enclose both.
 */
export const LOGO_BODY_PATH =
  "M 38 14 H 62 A 26 26 0 0 1 88 40 V 78 A 26 26 0 0 1 62 104 H 38 A 26 26 0 0 1 12 78 V 40 A 26 26 0 0 1 38 14 Z";

/** Side tabs, read as ears/arms. They stay outside the head so the rim lights them. */
export const LOGO_LEFT_HAND_PATH = "M 15 50 C 4 50 2 64 5 73 C 7 79 13 79 15 73 Z";
export const LOGO_RIGHT_HAND_PATH = "M 85 50 C 96 50 98 64 95 73 C 93 79 87 79 85 73 Z";

/** Shared vector paint palette for web SVG and react-native-svg. */
export function logoAvatarPaint(hex: string, originalOrange = false) {
  const full = hex.length === 4 ? `#${[...hex.slice(1)].map((c) => c + c).join("")}` : hex;
  const raw = originalOrange ? "#ff7b08" : full;
  const rgb = [1, 3, 5].map((i) => Number.parseInt(raw.slice(i, i + 2), 16));
  const shade = (factor: number) =>
    `#${rgb
      .map((v) =>
        Math.max(0, Math.min(255, Math.round(v * factor)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")}`;
  return {
    base: shade(1),
    light: shade(1.12),
    mid: shade(1),
    shadow: shade(0.8),
    edge: shade(0.96),
    deep: shade(0.55),
    flank: originalOrange ? "#c14d08" : shade(0.58),
    contact: originalOrange ? "#961b00" : shade(0.42),
    rim: originalOrange
      ? "#fff1dc"
      : `#${rgb
          .map((v) =>
            Math.round(v + (255 - v) * 0.9)
              .toString(16)
              .padStart(2, "0"),
          )
          .join("")}`,
  };
}

/** Shared, directional surface lighting for web and native SVG bodies. */
export const LOGO_AVATAR_LIGHTING = {
  body: { cx: "57%", cy: "30%", r: "76%" },
  flank: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(45 0 0 44 0 32)",
  },
  crown: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(34 0 0 33 57 23.5)",
    peak: 0.28,
    shoulder: 0.12,
  },
  leftHand: { cx: "60%", cy: "35%", r: "76%" },
  rightHand: { cx: "40%", cy: "35%", r: "76%" },
  leftContact: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(7.5 0 0 17 24.5 91)",
  },
  rightContact: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(7.5 0 0 17 75.5 91)",
  },
  rimUpper: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1.1,
    gradientTransform: "matrix(37.8239 0 0 48.5724 50.0193 49.4219)",
  },
  rimLeftTrim: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1,
    gradientTransform: "matrix(8.4 0 0 10.5 36 19)",
  },
  rimLeft: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1.1,
    gradientTransform: "matrix(66.2501 0 0 63.0879 -52.5 30.676)",
  },
  rimRight: {
    gradientUnits: "userSpaceOnUse",
    cx: 0,
    cy: 0,
    r: 1.1,
    gradientTransform: "matrix(66.2472 0 0 63.3467 152.5 30.5562)",
  },
  handLight: { leftPeak: 0.15, rightPeak: 0.24, radius: "62%" },
} as const;
