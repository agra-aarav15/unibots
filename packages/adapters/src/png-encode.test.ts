import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { encodePng, halveBgrx } from "./png-encode.js";

/** Two pixels: blue-then-green, and red-then-white in BGRX order, which is what a screen DC gives. */
function twoPixelsBgrx() {
  return Buffer.from([255, 0, 0, 0, 0, 255, 0, 0]);
}

describe("screen frames as PNG", () => {
  it("writes a real PNG, with blue and red where the caller expects them", async () => {
    const png = encodePng(2, 1, twoPixelsBgrx());
    expect([...png.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const image = sharp(Buffer.from(png));
    expect(await image.metadata()).toMatchObject({
      format: "png",
      width: 2,
      height: 1,
      channels: 3,
    });
    // BGRX (blue, green) must arrive as RGB (0,0,255) then (0,255,0).
    const { data } = await image.raw().toBuffer({ resolveWithObject: true });
    expect([...data]).toEqual([0, 0, 255, 0, 255, 0]);
  });

  it("keeps a frame's rows in order rather than mirrored", async () => {
    const rows = Buffer.concat([
      Buffer.from([255, 0, 0, 0]), // Blue on the top row.
      Buffer.from([0, 0, 255, 0]), // Red on the bottom row.
    ]);
    const { data } = await sharp(Buffer.from(encodePng(1, 2, rows)))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data]).toEqual([0, 0, 255, 255, 0, 0]);
  });

  it("refuses a frame with no pixels", () => {
    expect(() => encodePng(0, 10, Buffer.alloc(0))).toThrow("both dimensions");
  });

  it("halves a frame by averaging, so an oversized one can still be sent", () => {
    // A 4x2 frame: blue on the left half, white on the right. It becomes two pixels.
    const pixels = Buffer.alloc(4 * 2 * 4);
    for (let y = 0; y < 2; y += 1) {
      for (let x = 0; x < 4; x += 1) {
        const at = (y * 4 + x) * 4;
        pixels[at] = 255; // Blue, which every pixel keeps.
        if (x < 2) continue;
        pixels[at + 1] = 255;
        pixels[at + 2] = 255;
      }
    }
    const halved = halveBgrx(4, 2, pixels);
    expect(halved).toMatchObject({ width: 2, height: 1 });
    // Averaging keeps the BGRX order it was given: blue on the left, white on the right.
    expect([...halved.pixels]).toEqual([255, 0, 0, 0, 255, 255, 255, 0]);
  });
});
