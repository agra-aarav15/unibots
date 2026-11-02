import { expect, it } from "vitest";
import {
  LOGO_BODY_PATH,
  LOGO_LEFT_HAND_PATH,
  LOGO_RIGHT_HAND_PATH,
} from "./logo-avatar-art.js";

type Point = [number, number];

/** Every absolute command in the path, in order, so bounds and symmetry can be checked. */
function outline(path: string) {
  const points: Point[] = [];
  for (const [, command, body] of path.matchAll(/([MLHVCA])([^MLHVCAZ]*)/g)) {
    const numbers = (body ?? "").match(/-?\d+(?:\.\d+)?/g)?.map(Number) ?? [];
    const last = points.at(-1);
    if (command === "M" || command === "L") points.push([numbers[0]!, numbers[1]!]);
    else if (command === "H" && last) points.push([numbers[0]!, last[1]]);
    else if (command === "V" && last) points.push([last[0], numbers[0]!]);
    // A cubic carries two control points; only its end point is on the outline.
    else if (command === "C") points.push([numbers[4]!, numbers[5]!]);
    // An arc carries rx ry rotation large-arc sweep x y; its end point is last.
    else if (command === "A" && last) points.push([numbers[5]!, numbers[6]!]);
  }
  return points;
}

it("draws a symmetric head that encloses the eyes and the book", () => {
  const points = outline(LOGO_BODY_PATH);
  expect(points.length).toBeGreaterThanOrEqual(8);
  for (const [x, y] of points) {
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  }

  const xs = points.map(([x]) => x);
  const ys = points.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const top = Math.min(...ys);
  const bottom = Math.max(...ys);

  // The outline is mirrored around the avatar's centre line.
  expect(left + right).toBeCloseTo(100, 5);
  expect(top).toBeLessThan(49);
  expect(bottom).toBeGreaterThan(94);

  // Eyes (cx 39/61, cy 49, ry 9) and the book (y 75..94) both sit inside the head.
  expect(left).toBeLessThan(39 - 7);
  expect(right).toBeGreaterThan(61 + 7);
  expect(bottom).toBeGreaterThan(94);
});

it("keeps the side tabs outside the head, mirrored, and clear of the eyes", () => {
  const headPoints = outline(LOGO_BODY_PATH);
  const headLeft = Math.min(...headPoints.map(([x]) => x));
  const headRight = Math.max(...headPoints.map(([x]) => x));

  const leftPoints = outline(LOGO_LEFT_HAND_PATH);
  const rightPoints = outline(LOGO_RIGHT_HAND_PATH);

  expect(Math.min(...leftPoints.map(([x]) => x))).toBeLessThan(headLeft);
  expect(Math.max(...rightPoints.map(([x]) => x))).toBeGreaterThan(headRight);

  // Mirror symmetry: each right-hand point is the left-hand point reflected about x=50.
  for (const [x, y] of leftPoints) {
    const mirror = rightPoints.find(
      ([rx, ry]) => Math.abs(rx - (100 - x)) < 0.01 && Math.abs(ry - y) < 0.01,
    );
    expect(mirror, `no mirror for ${x},${y}`).toBeDefined();
  }

  // Tabs sit beside the eyes, not over them.
  for (const [x, y] of [...leftPoints, ...rightPoints]) {
    expect(y).toBeGreaterThan(45);
    expect(Math.abs(x - 50)).toBeGreaterThan(30);
  }
});