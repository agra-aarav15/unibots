import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import {
  adaptiveGlyphSvg,
  glyphSvg,
  MARK,
  MARK_PLATE_COLOR,
  monoMarkSvg,
  plateSvg,
  rosterMarkSvg,
} from "../src/mark.ts";

/**
 * Rasterises the Unibots mark into every platform asset.
 *
 * The geometry lives in `src/mark.ts`; this script only picks sizes and file
 * names. Run `pnpm --filter @rakazo/ui-tokens export:brand` after editing it.
 */

const root = new URL("../../../", import.meta.url);
const path = (name: string) => fileURLToPath(new URL(name, root));

const svg = (markup: string) => Buffer.from(markup);

/** Render one SVG at an exact pixel size. */
async function render(markup: string, size: number): Promise<Buffer> {
  return sharp(svg(markup), {
    density: Math.max(72, Math.ceil((size / 1024) * 72 * 4)),
  })
    .resize(size, size)
    .png()
    .toBuffer();
}

async function png(markup: string, name: string, size: number): Promise<void> {
  await sharp(await render(markup, size)).png().toFile(path(name));
}

/** PNG frames inside an ICO are supported by Windows and every browser today. */
async function ico(markup: string, name: string, sizes: number[]): Promise<void> {
  const frames = await Promise.all(sizes.map((size) => render(markup, size)));
  const header = Buffer.alloc(6 + frames.length * 16);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(frames.length, 4);
  let offset = header.length;
  frames.forEach((frame, index) => {
    const entry = 6 + index * 16;
    header[entry] = header[entry + 1] = sizes[index] === 256 ? 0 : sizes[index]!;
    header.writeUInt16LE(1, entry + 4);
    header.writeUInt16LE(32, entry + 6);
    header.writeUInt32LE(frame.length, entry + 8);
    header.writeUInt32LE(offset, entry + 12);
    offset += frame.length;
  });
  await writeFile(path(name), Buffer.concat([header, ...frames]));
}

const plate = plateSvg();
const glyph = glyphSvg();
const adaptive = adaptiveGlyphSvg();
const mono = monoMarkSvg();

// Web app and marketing site share the browser icons.
for (const app of ["web", "www"]) {
  const publicDir = `apps/${app}/public`;
  await png(plate, `${publicDir}/favicon-16x16.png`, 16);
  await png(plate, `${publicDir}/favicon-32x32.png`, 32);
  await png(plate, `${publicDir}/favicon.png`, 128);
  await png(plate, `${publicDir}/apple-touch-icon.png`, 180);
  await png(plate, `${publicDir}/icon-192.png`, 192);
  await png(plate, `${publicDir}/icon-512.png`, 512);
  await ico(plate, `${publicDir}/favicon.ico`, [16, 32, 48]);
}

// Marketing logo, structured data, and social cards reference this file.
await mkdir(path("apps/www/public/brand"), { recursive: true });
await png(plate, "apps/www/public/brand/unibots-mark.png", 256);

// Roster art for the marketing team list: one tinted plate per role, so eight
// teammates read as one family without any character artwork.
const ROSTER: Record<string, string> = {
  "inbox-manager": "#3b82f6",
  "sales-outbound": "#f2622a",
  "talent-scout": "#9b5cf6",
  "expense-manager": "#3ec5a8",
  "coding-agent": "#6a6bf5",
  "account-manager": "#d9508a",
  "paid-media": "#f5a03c",
  "chief-of-staff": "#0f9d8a",
};
await mkdir(path("apps/www/public/brand/job-bots"), { recursive: true });
for (const [slug, color] of Object.entries(ROSTER)) {
  await sharp(Buffer.from(rosterMarkSvg(color, 384)))
    .webp({ quality: 92 })
    .toFile(path(`apps/www/public/brand/job-bots/${slug}.webp`));
}

// iOS and macOS read the Icon Composer bundle; its asset is the transparent glyph.
await sharp(svg(glyph))
  .resize(1024, 1024, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path("packages/ui-tokens/assets/Unibots.icon/Assets/unibots-glyph.png"));

// Android launcher: separate background and foreground layers, plus the monochrome tier.
await png(plate, "apps/mobile/assets/icon.png", 1024);
await png(adaptive, "apps/mobile/assets/adaptive-icon.png", 1024);
await png(mono, "apps/mobile/assets/monochrome-icon.png", 1024);
await sharp({
  create: { width: 1024, height: 1024, channels: 4, background: MARK_PLATE_COLOR },
})
  .png()
  .toFile(path("apps/mobile/assets/icon-background.png"));
await png(plate, "apps/mobile/assets/favicon.png", 128);

// Splash: the glyph alone, padded so it sits on either splash colour.
await sharp(await render(glyph, 620))
  .extend({ top: 202, bottom: 202, left: 202, right: 202, background: { r: 0, g: 0, b: 0, alpha: 0 } })
  .png()
  .toFile(path("apps/mobile/assets/splash-icon.png"));

// Status-bar icons must be flat white with transparency, never colour.
await sharp(await render(mono, 72)).png().toFile(path("apps/mobile/assets/notification-icon.png"));

// Desktop: Windows/Linux icon set plus the development and macOS exports.
await png(plate, "apps/desktop/assets/icon.png", 1024);
await ico(plate, "apps/desktop/assets/icon.ico", [16, 32, 48, 64, 128, 256]);
await png(plate, "apps/desktop/assets/icon-macos.png", 1024);

// Installer sidebar art: the glyph on the light plate the NSIS wizard draws.
const installerPlate = `<svg xmlns="http://www.w3.org/2000/svg" width="660" height="400" viewBox="0 0 660 400"><rect width="660" height="400" fill="#fcfcfc"/><g transform="translate(179 22) scale(0.3)">${glyphSvg().replace(/^<svg[^>]*>|<\/svg>$/g, "")}</g></svg>`;
await sharp(svg(installerPlate)).png().toFile(path("apps/desktop/assets/background.png"));
await sharp(svg(installerPlate)).resize(1320, 800).png().toFile(
  path("apps/desktop/assets/background@2x.png"),
);

// Keep the design grid honest: a stroke wider than the bowl cannot form a U.
if (MARK.stroke >= MARK.bowlRadius * 2) {
  throw new Error("MARK.stroke is too wide for the bowl radius");
}

console.log("Exported Unibots mark to web, www, mobile, desktop, and the icon bundle.");