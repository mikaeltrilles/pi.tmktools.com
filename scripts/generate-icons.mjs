#!/usr/bin/env node
/**
 * Génère les icônes PWA (PNG) et l'image Open Graph de pi.tmktools.com à partir
 * de dessins SVG, sur le même gabarit que phi.tmktools.com (accent cyan pour π).
 * Le glyphe π est tracé en chemins vectoriels, sans dépendre d'une police.
 * Usage : npm run icons   (nécessite la dépendance de développement « sharp »)
 */
import sharp from 'sharp';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const iconsDir = join(root, 'public', 'icons');
await mkdir(iconsDir, { recursive: true });

const CYAN = '#22d3ee';
const BG = '#0b0f14';

/** Symbole π tracé en chemins, centré dans un carré de 64 unités. */
function piGlyph({ x = 0, y = 0, scale = 1, color = CYAN, stroke = 4.5 } = {}) {
  return `
    <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="${color}" stroke-width="${stroke}" stroke-linecap="round">
      <line x1="16" y1="22" x2="50" y2="22"/>
      <path d="M25 22 Q24.5 36 21 48"/>
      <path d="M40 22 Q41 38 44 46 Q46.5 50 50 46"/>
    </g>`;
}

/** Icône carrée ; `padding` réserve la zone sûre des icônes maskable. */
function iconSvg(size, { padding = 0, rounded = true } = {}) {
  const inner = size - padding * 2;
  const scale = inner / 64;
  const radius = rounded ? size * 0.22 : 0;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}">
    <rect width="${size}" height="${size}" rx="${radius}" fill="${BG}"/>
    <circle cx="${size / 2}" cy="${size / 2}" r="${inner * 0.41}" fill="none" stroke="${CYAN}" stroke-opacity="0.22" stroke-width="${Math.max(1, size / 42)}"/>
    ${piGlyph({ x: padding, y: padding, scale })}
  </svg>`;
}

/** Image Open Graph 1200×630 : symbole, titre et premières décimales. */
function ogSvg() {
  const digits = '3.1415926535 8979323846 2643383279 5028841971';
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
    <defs>
      <radialGradient id="glow" cx="0.25" cy="0.4" r="0.6">
        <stop offset="0" stop-color="${CYAN}" stop-opacity="0.18"/>
        <stop offset="1" stop-color="${CYAN}" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <rect width="1200" height="630" fill="${BG}"/>
    <rect width="1200" height="630" fill="url(#glow)"/>
    <circle cx="240" cy="315" r="190" fill="none" stroke="${CYAN}" stroke-opacity="0.2" stroke-width="3"/>
    ${piGlyph({ x: 80, y: 155, scale: 5, stroke: 4 })}
    <text x="500" y="250" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="64" font-weight="700" fill="#e9edf2">Nombre π</text>
    <text x="500" y="330" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="40" fill="${CYAN}">Décimales calculées en continu</text>
    <text x="500" y="410" font-family="DejaVu Sans Mono, Liberation Mono, monospace" font-size="24" fill="#9aa6b5">${digits}</text>
    <text x="500" y="470" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="26" fill="#9aa6b5">Algorithme de Chudnovsky · retranscription en direct</text>
    <text x="500" y="540" font-family="DejaVu Sans, Liberation Sans, Arial, sans-serif" font-size="24" fill="${CYAN}">pi.tmktools.com</text>
  </svg>`;
}

async function render(svg, file, { width, height = width } = {}) {
  await sharp(Buffer.from(svg), { density: 300 }).resize(width, height).png({ compressionLevel: 9 }).toFile(file);
  console.log(`✓ ${file}`);
}

await render(iconSvg(192), join(iconsDir, 'icon-192.png'), { width: 192 });
await render(iconSvg(512), join(iconsDir, 'icon-512.png'), { width: 512 });
await render(iconSvg(512, { padding: 64, rounded: false }), join(iconsDir, 'icon-maskable-512.png'), { width: 512 });
await render(iconSvg(180), join(iconsDir, 'apple-touch-icon.png'), { width: 180 });
await render(iconSvg(32), join(iconsDir, 'favicon-32.png'), { width: 32 });
await render(ogSvg(), join(root, 'public', 'og-image.png'), { width: 1200, height: 630 });
await writeFile(join(iconsDir, '.gitkeep'), '');
