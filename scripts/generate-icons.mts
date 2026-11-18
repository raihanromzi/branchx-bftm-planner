// Generates the app icons (E0-S4): a white "BP" monogram on the teal accent (#0E6E73).
// Run once with `node scripts/generate-icons.mts`; the PNGs it writes to public/icons/ are committed.
// The letters are drawn as strokes, so the output does not depend on fonts installed on the machine.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import sharp from "sharp";

const TEAL = "#0E6E73";
const outDir = join(import.meta.dirname, "..", "public", "icons");

// The monogram on a 168 × 100 grid with a 20-unit stroke: B at x 0..75, P at x 93..168.
const LETTERS = `
  <g fill="none" stroke="#FFFFFF" stroke-width="20" stroke-linejoin="miter">
    <path d="M10 0 V100" />
    <path d="M10 10 H40 A20 20 0 0 1 40 50 H10" />
    <path d="M10 50 H45 A20 20 0 0 1 45 90 H10" />
    <path d="M103 0 V100" />
    <path d="M103 10 H135 A22.5 22.5 0 0 1 135 55 H103" />
  </g>`;

/** An icon `size` px square; the monogram is `share` of the width. */
function svg(size: number, share: number): string {
  const scale = (size * share) / 168;
  const x = (size - 168 * scale) / 2;
  const y = (size - 100 * scale) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
  <rect width="${size}" height="${size}" fill="${TEAL}" />
  <g transform="translate(${x} ${y}) scale(${scale})">${LETTERS}</g>
</svg>`;
}

const icons: Array<[file: string, size: number, share: number]> = [
  ["icon-192.png", 192, 0.6],
  ["icon-512.png", 512, 0.6],
  // Maskable: the monogram stays inside the 80% safe zone of any mask shape.
  ["icon-maskable-512.png", 512, 0.46],
  ["apple-touch-icon.png", 180, 0.6],
  ["favicon-32.png", 32, 0.7],
];

mkdirSync(outDir, { recursive: true });
for (const [file, size, share] of icons) {
  await sharp(Buffer.from(svg(size, share))).png().toFile(join(outDir, file));
  console.log(`wrote public/icons/${file}`);
}
