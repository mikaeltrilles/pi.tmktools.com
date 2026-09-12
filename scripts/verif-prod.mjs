#!/usr/bin/env node
// verif-prod.mjs — Contrôle de l'interface en production avec Playwright.
//
// Usage : node scripts/verif-prod.mjs [url]   (défaut : https://pi.tmktools.com/)
//
// IMPORTANT — le userAgent est forcé sur un Chrome ordinaire. L'agent par défaut
// de Playwright contient « HeadlessChrome », qu'o2switch identifie comme un robot :
// les ressources reviennent alors en « 429 Too Many Requests » et la page s'affiche
// sans css ni js, « Hors ligne », alors que le site est parfaitement sain. Sans
// cette précaution, le contrôle conclut à une panne inexistante (12 septembre 2026).
import { chromium } from '../../phi.tmktools.com/node_modules/playwright/index.mjs';
import { existsSync, readdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const URL_CIBLE = process.argv[2] || 'https://pi.tmktools.com/';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

// La version de Playwright et le Chromium téléchargé peuvent diverger : on prend
// le binaire réellement présent plutôt que celui attendu par la bibliothèque.
function trouverChromium() {
  const cache = join(homedir(), '.cache/ms-playwright');
  if (!existsSync(cache)) return undefined;
  const dossier = readdirSync(cache).filter((d) => d.startsWith('chromium-')).sort().pop();
  if (!dossier) return undefined;
  const bin = join(cache, dossier, 'chrome-linux64/chrome');
  return existsSync(bin) ? bin : undefined;
}

const configurations = [
  { nom: 'bureau-sombre', viewport: { width: 1440, height: 900 }, theme: 'dark' },
  { nom: 'bureau-clair', viewport: { width: 1440, height: 900 }, theme: 'light' },
  { nom: 'mobile-sombre', viewport: { width: 390, height: 844 }, theme: 'dark' },
  { nom: 'mobile-clair', viewport: { width: 320, height: 700 }, theme: 'light' },
];

const navigateur = await chromium.launch({ executablePath: trouverChromium() });
let echecs = 0;

// Pause entre deux configurations : enchaîner les chargements complets finit par
// atteindre la limite de débit de l'hébergement, qui répond 429 (typiquement sur
// l'enregistrement du service worker). C'est une limite du contrôle, pas du site.
const pause = (ms) => new Promise((r) => setTimeout(r, ms));

for (const [index, conf] of configurations.entries()) {
  if (index > 0) await pause(20000);
  const contexte = await navigateur.newContext({
    userAgent: UA,
    viewport: conf.viewport,
    colorScheme: conf.theme,
    isMobile: conf.viewport.width < 500,
    hasTouch: conf.viewport.width < 500,
  });
  const page = await contexte.newPage();
  const erreursConsole = [];
  const reponsesKo = [];
  page.on('console', (m) => { if (m.type() === 'error') erreursConsole.push(m.text()); });
  page.on('pageerror', (e) => erreursConsole.push(`pageerror: ${e.message}`));
  page.on('response', (r) => { if (r.status() >= 400) reponsesKo.push(`${r.status()} ${new URL(r.url()).pathname}`); });

  const reponse = await page.goto(URL_CIBLE, { waitUntil: 'load', timeout: 60000 });
  await page.waitForTimeout(9000); // laisse le flux SSE s'établir

  const debordement = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );
  const texte = await page.evaluate(() => document.body.innerText.replace(/\s+/g, ' '));
  const connecte = /Connect[ée]/i.test(texte);
  const calculActif = /Calcul actif/i.test(texte);

  const defauts = [];
  if (reponse.status() !== 200) defauts.push(`HTTP ${reponse.status()}`);
  if (debordement) defauts.push('débordement horizontal');
  if (erreursConsole.length) defauts.push(`${erreursConsole.length} erreur(s) console`);
  if (reponsesKo.length) defauts.push(`ressources en échec : ${reponsesKo.join(', ')}`);
  if (!connecte) defauts.push('flux SSE non connecté');
  if (!calculActif) defauts.push('calcul signalé inactif');

  if (defauts.length) echecs++;
  console.log(`${defauts.length ? '❌' : '✅'} ${conf.nom.padEnd(14)} ${defauts.length ? defauts.join(' ; ') : 'conforme (SSE connecté, calcul actif, aucun débordement)'}`);
  if (erreursConsole.length) erreursConsole.slice(0, 3).forEach((e) => console.log(`      ${e.slice(0, 160)}`));

  await contexte.close();
}

await navigateur.close();
console.log(echecs === 0 ? '\n✅ Production conforme' : `\n❌ ${echecs} configuration(s) en défaut`);
process.exit(echecs === 0 ? 0 : 1);
