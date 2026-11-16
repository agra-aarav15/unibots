import { deflateSync } from "node:zlib";

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let index = 0; index < 256; index += 1) {
    let value = index;
    for (let bit = 0; bit < 8; bit += 1)
      value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[index] = value >>> 0;
  }
  return table;
})();

function crc32(bytes: Uint8Array) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = (CRC_TABLE[(crc ^ byte) & 0xff] ?? 0) ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer) {
  const header = Buffer.alloc(8);
  header.writeUInt32BE(data.byteLength, 0);
  header.write(type, 4, "ascii");
  const body = Buffer.concat([header.subarray(4), data]);
  const trailer = Buffer.alloc(4);
  trailer.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([header, data, trailer]);
}

/**
 * Encodes one screen frame as an 8-bit RGB PNG. The pixels arrive as BGRX, which is what a Windows
 * screen DC hands back, so blue and red are swapped while each row is written. Frames are written
 * with no filter: a screen has flat regions that deflate well, and filtering costs more than it
 * saves on a frame this size.
 */
export function encodePng(width: number, height: number, pixels: Buffer): Uint8Array {
  if (width < 1 || height < 1) throw new Error("A frame needs both dimensions");
  const stride = width * 4;
  const rows = Buffer.alloc(height * (1 + width * 3));
  for (let y = 0; y < height; y += 1) {
    const source = y * stride;
    let target = y * (1 + width * 3);
    rows[target] = 0;
    target += 1;
    for (let x = 0; x < width; x += 1) {
      rows[target] = pixels[source + x * 4 + 2] ?? 0;
      rows[target + 1] = pixels[source + x * 4 + 1] ?? 0;
      rows[target + 2] = pixels[source + x * 4] ?? 0;
      target += 3;
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // Bits per channel.
  header[9] = 2; // Truecolour.
  return new Uint8Array(
    Buffer.concat([
      Buffer.from(SIGNATURE),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows, { level: 6 })),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
}

/** Halves a BGRX frame by averaging each 2x2 block, so a frame too large to send can still be seen. */
export function halveBgrx(width: number, height: number, pixels: Buffer) {
  const scaled = { width: Math.max(1, width >> 1), height: Math.max(1, height >> 1) };
  const output = Buffer.alloc(scaled.width * scaled.height * 4);
  for (let y = 0; y < scaled.height; y += 1) {
    const top = Math.min(y * 2, height - 1);
    const bottom = Math.min(y * 2 + 1, height - 1);
    for (let x = 0; x < scaled.width; x += 1) {
      const left = Math.min(x * 2, width - 1);
      const right = Math.min(x * 2 + 1, width - 1);
      const target = (y * scaled.width + x) * 4;
      for (let channel = 0; channel < 4; channel += 1) {
        const total =
          (pixels[(top * width + left) * 4 + channel] ?? 0) +
          (pixels[(top * width + right) * 4 + channel] ?? 0) +
          (pixels[(bottom * width + left) * 4 + channel] ?? 0) +
          (pixels[(bottom * width + right) * 4 + channel] ?? 0);
        output[target + channel] = Math.round(total / 4);
      }
    }
  }
  return { ...scaled, pixels: output };
}
