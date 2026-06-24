/**
 * π Explorer — Backend Node.js/Express
 *
 * Calcul continu de π, jamais arrêtable.
 * Reprise automatique depuis data/pi_complet.txt au démarrage.
 * Milestones dynamiques : le calcul ne s arrête jamais.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { EventEmitter } = require('events');

/* ════════════════════════════════════════════════════════════════════════════
   WORKER — Chudnovsky BigInt
   ════════════════════════════════════════════════════════════════════════════ */
if (!isMainThread) {
  const { precision } = workerData;

  // Racine carrée entière par méthode de Newton
  function sqrt(n) {
    if (n < 0n) return 0n;
    if (n < 2n) return n;
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
      x = y;
      y = (x + n / x) / 2n;
    }
    return x;
  }

  const extra = 10;
  const scale = 10n ** BigInt(precision + extra);

  // Constantes Chudnovsky
  const A = 13591409n;
  const B = 545140134n;
  const C = 640320n;
  const C3 = C * C * C; // 640320^3

  // sqrt(10005) à l'échelle `scale`
  const sqrt10005 = sqrt(10005n * scale * scale);

  // Calcul de S = Σ (-1)^k * (6k)! * (A + B*k) * scale / [(3k)! * (k!)^3 * C^(3k)]
  let S = A * scale; // k = 0
  let k = 1n;

  // Seuil d'arrêt : terme < scale / 10^precision
  const minTerm = scale / (10n ** BigInt(precision));

  while (true) {
    const k6 = k * 6n;
    const k3 = k * 3n;

    // Factorielles (k max ≈ precision/14, donc très petit)
    let f6 = 1n;
    for (let i = 2n; i <= k6; i++) f6 *= i;
    let f3 = 1n;
    for (let i = 2n; i <= k3; i++) f3 *= i;
    let fk = 1n;
    for (let i = 2n; i <= k; i++) fk *= i;

    const L = A + B * k;
    const num = f6 * L * scale;
    const den = f3 * (fk ** 3n) * (C3 ** k);
    const term = num / den;

    if (k % 2n === 1n) {
      S -= term; // (-1)^k pour k impair
    } else {
      S += term; // (-1)^k pour k pair
    }

    if (term < minTerm) break;
    k++;
  }

  // π = (426880 * sqrt(10005)) / S
  // piScaled ≈ π * scale
  const piScaled = (426880n * sqrt10005 * scale) / S;
  // Retirer les chiffres de garde
  const piFinal = piScaled / (10n ** BigInt(extra));

  const s = piFinal.toString();
  const result = '3.' + s.slice(1, precision + 1);
  parentPort.postMessage({ digits: result });
  return;
}

/* ════════════════════════════════════════════════════════════════════════════
   MAIN THREAD — Serveur Express
   ════════════════════════════════════════════════════════════════════════════ */

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pi_digits.txt');
const HISTORY_FILE = path.join(DATA_DIR, 'pi_history.log');
const COMPLET_FILE = path.join(DATA_DIR, 'pi_complet.txt');
const BLOCK_SIZE = 10;
const BLOCK_DELAY_MS = 20;
const CATCHUP_BLOCK = 100;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ── Middleware ── */
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

/* ════════════════════════════════════════════════════════════════════════════
   MODE CONTINU — État global + EventEmitter
   ════════════════════════════════════════════════════════════════════════════ */
const continuousEmitter = new EventEmitter();
continuousEmitter.setMaxListeners(50);

let continuousState = {
  running: false,
  digits: '3.',
  milestoneIdx: -1,
  startTime: null,
  clients: new Set(),
};

function snapshotPath(n) {
  return path.join(DATA_DIR, `pi_${n}.txt`);
}

/* Paliers intéressants : 100, 500, 1 000, 5 000, 10 000, 50 000, 100 000…
   (tout nombre ≥ 100 qui commence par 1 ou 5 suivi uniquement de 0) */
function isInterestingMilestone(n) {
  return /^[15]0+$/.test(n.toString());
}

async function writeSnapshot(digits, n) {
  const header = [
    `# Pi Snapshot made with ♥ by PI Explorer`,
    `# Généré le : ${new Date().toISOString()}`,
    `# Nombre de décimales : ${digits.length - 2}`,
    '# Algorithme : Chudnovsky (BigInt)',
    '#',
    digits,
    ''
  ].join('\n');
  await fs.promises.writeFile(snapshotPath(n), header, 'utf8');
}

async function writeComplet(digits) {
  const header = [
    '# Pi Complet made with ♥ by PI Explorer',
    `# Dernière mise à jour : ${new Date().toISOString()}`,
    `# Nombre total de décimales : ${digits.length - 2}`,
    '# Algorithme : Chudnovsky (BigInt)',
    '#',
    digits,
    ''
  ].join('\n');
  await fs.promises.writeFile(COMPLET_FILE, header, 'utf8');
}

async function appendHistory(line) {
  await fs.promises.appendFile(HISTORY_FILE, line, 'utf8');
}

/* ── Reprise depuis le fichier complet ── */
async function loadContinuousStateFromDisk() {
  try {
    const content = await fs.promises.readFile(COMPLET_FILE, 'utf8');
    const lines = content.split('\n');
    let total = 0;
    let digits = '3.';

    for (const line of lines) {
      if (line.startsWith('# Nombre total de décimales :')) {
        total = parseInt(line.split(':')[1].trim(), 10) || 0;
      }
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('3.')) {
        digits = trimmed;
        break;
      }
    }

    if (digits.length > 2) {
      continuousState.digits = digits;
      // milestoneIdx = nombre de pas déjà effectués
      continuousState.milestoneIdx = Math.floor(total / STEP);
      console.log(`⏮️  Reprise depuis disque : ${total.toLocaleString('fr-FR')} décimales (pas ${continuousState.milestoneIdx})`);
      await appendHistory(`${new Date().toISOString()} | RESUME | ${total} décimales restaurées depuis pi_complet.txt\n`);
    }
  } catch (e) {
    if (e.code === 'ENOENT') {
      console.log('🆕 Nouveau démarrage — aucun pi_complet.txt trouvé');
    } else {
      console.error('Erreur lecture pi_complet.txt :', e.message);
    }
  }
}

/* ── Broadcast SSE ── */
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of continuousState.clients) {
    try { res.write(data); } catch { continuousState.clients.delete(res); }
  }
}

/* ── Stream décimales aux clients ── */
function streamDecimalsToClients(decimals, offsetStart, total, milestone, isLive = true, milestoneStart = offsetStart) {
  const chunkSize = isLive ? BLOCK_SIZE : CATCHUP_BLOCK;
  const delay = isLive ? BLOCK_DELAY_MS : 20;

  let offset = offsetStart;
  let idx = 0;

  const sendNext = () => {
    if (!continuousState.running && isLive) return;
    const block = decimals.slice(idx, idx + chunkSize);
    if (!block) return;
    broadcast('digits', { block, offset, total, milestone, milestoneStart });
    idx += block.length;
    offset += block.length;
    if (idx < decimals.length) {
      setTimeout(sendNext, delay);
    }
  };

  sendNext();
}

const STEP = 100; // calcul par pas de 100 décimales pour un flux ultra-fluide

/* ── Logique du calcul par pas (flux continu sans attente) ── */
async function runNextMilestone() {
  if (!continuousState.running) return;

  const prevLen = continuousState.digits.length - 2;
  const target = prevLen + STEP;

  broadcast('status', { status: 'computing', milestone: target, current_decimals: prevLen });

  const worker = new Worker(__filename, { workerData: { precision: target } });

  worker.on('message', async ({ digits }) => {
    continuousState.digits = digits;
    continuousState.milestoneIdx++;

    const newDec = digits.slice(2 + prevLen);
    const total = digits.length - 2;

    // Streamer les nouvelles décimales aux clients immédiatement
    streamDecimalsToClients(newDec, prevLen, total, target, true, prevLen);

    // Snapshots aux paliers intéressants : 100, 500, 1000, 5000, 10000, 50000…
    if (isInterestingMilestone(target)) await writeSnapshot(digits, target);
    await writeComplet(digits);
    await appendHistory(`${new Date().toISOString()} | +${STEP} → ${target} | ${total} décimales\n`);

    // Notifier
    setTimeout(() => {
      broadcast('milestone', { milestone: target, total_decimals: total });
    }, Math.ceil(newDec.length / BLOCK_SIZE) * BLOCK_DELAY_MS + 100);

    worker.terminate().catch(() => {});

    // Suite immédiate — pas de pause longue
    setTimeout(() => runNextMilestone(), 400);
  });

  worker.on('error', (err) => {
    console.error('Continuous worker error :', err);
    broadcast('error', { message: err.message });
    worker.terminate().catch(() => {});
    // Retry après 5s — le calcul ne doit jamais s arrêter
    setTimeout(() => runNextMilestone(), 5000);
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUTES
   ════════════════════════════════════════════════════════════════════════════ */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── Sauvegarde manuelle (toujours disponible) ── */
app.post('/save', async (req, res) => {
  const { digits } = req.body;
  if (!digits || !digits.startsWith('3.')) {
    return res.status(400).json({ error: 'Format invalide (attendu 3.14...)' });
  }
  try {
    const header = [
      '# Pi Digits made with ♥ by PI Explorer',
      `# Généré le : ${new Date().toISOString()}`,
      `# Nombre de décimales : ${digits.length - 2}`,
      '# Algorithme : Chudnovsky (BigInt)',
      '#',
      digits, ''
    ].join('\n');
    await fs.promises.writeFile(DATA_FILE, header, 'utf8');
    await appendHistory(`${new Date().toISOString()} | SAVE | ${digits.length - 2} décimales\n`);
    res.json({ saved: true, digits_count: digits.length - 2 });
  } catch (err) {
    res.status(500).json({ error: 'Échec de la sauvegarde.' });
  }
});

app.get('/stored', async (req, res) => {
  try {
    const txt = await fs.promises.readFile(DATA_FILE, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.send(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).send('# Aucun fichier stocké.\n');
    res.status(500).send('Erreur de lecture.');
  }
});

app.get('/stats', async (req, res) => {
  try {
    const st = await fs.promises.stat(COMPLET_FILE);
    const txt = await fs.promises.readFile(COMPLET_FILE, 'utf8');
    let total = 0, last = null;
    for (const l of txt.split('\n')) {
      if (l.startsWith('# Nombre total de décimales :')) total = parseInt(l.split(':')[1].trim(), 10) || 0;
      if (l.startsWith('# Dernière mise à jour :')) last = new Date(l.split(':').slice(1).join(':').trim()).toISOString();
    }
    res.json({ total_digits_stored: total, last_computed: last, file_size_kb: Math.round(st.size / 1024 * 10) / 10 });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ total_digits_stored: 0, last_computed: null, file_size_kb: 0 });
    res.status(500).json({ error: 'Erreur' });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   ROUTES MODE CONTINU
   ════════════════════════════════════════════════════════════════════════════ */

/* Démarrer le calcul continu (appelé auto au boot, mais route dispo) */
app.post('/start-continuous', (req, res) => {
  if (continuousState.running) {
    return res.json({ started: false, reason: 'Déjà en cours', state: continuousState });
  }
  continuousState.running = true;
  continuousState.startTime = Date.now();
  runNextMilestone();
  res.json({ started: true });
});

/* Arrêter — route gardée pour admin d urgence, mais le calcul redémarre auto */
app.post('/stop-continuous', (req, res) => {
  continuousState.running = false;
  broadcast('stopped', { total_decimals: continuousState.digits.length - 2 });
  res.json({ stopped: true, total_decimals: continuousState.digits.length - 2 });
});

/* État du calcul continu */
app.get('/continuous-state', (req, res) => {
  const total = continuousState.digits.length - 2;
  res.json({
    running: continuousState.running,
    total_decimals: total,
    next_target: total + STEP,
    elapsed_ms: continuousState.startTime ? Date.now() - continuousState.startTime : null,
  });
});

/* SSE continu — rattrapage puis live */
app.get('/stream-continuous', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  continuousState.clients.add(res);

  const total = continuousState.digits.length - 2;
  // État initial
  res.write(`event: state\ndata: ${JSON.stringify({
    running: continuousState.running,
    total_decimals: total,
    next_target: total + STEP,
  })}\n\n`);

  // Catch-up limité aux 1 000 dernières décimales pour que la grille
  // Mini catch-up des 1 000 dernières décimales pour que la grille ne soit pas vide
  const existing = continuousState.digits.slice(2);
  if (existing.length > 0) {
    const TAIL = 1000;
    const tail = existing.slice(-TAIL);
    const total = existing.length;
    const offsetStart = total - tail.length;
    streamDecimalsToClients(tail, offsetStart, total, total + STEP, false, offsetStart);
  }

  // Heartbeat toutes les 30s pour garder la connexion SSE ouverte
  const ping = setInterval(() => {
    try {
      res.write(':ping\n\n');
    } catch {
      clearInterval(ping);
      continuousState.clients.delete(res);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(ping);
    continuousState.clients.delete(res);
  });
});

/* Liste des snapshots */
app.get('/snapshots', async (req, res) => {
  try {
    const files = await fs.promises.readdir(DATA_DIR);
    const snaps = files
      .filter(f => f.startsWith('pi_') && f.endsWith('.txt') && f !== 'pi_digits.txt' && f !== 'pi_complet.txt' && f !== 'pi_history.log')
      .map(f => {
        const n = parseInt(f.replace('pi_', '').replace('.txt', ''), 10);
        return { n, file: f, path: `/snapshot/${n}` };
      })
      .sort((a, b) => a.n - b.n);
    res.json({ snapshots: snaps });
  } catch { res.json({ snapshots: [] }); }
});

/* Télécharger un snapshot */
app.get('/snapshot/:n', async (req, res) => {
  const n = parseInt(req.params.n, 10);
  const file = snapshotPath(n);
  try {
    const txt = await fs.promises.readFile(file, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="pi_${n}.txt"`);
    res.send(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).send('# Snapshot non trouvé.\n');
    res.status(500).send('Erreur.');
  }
});

/* Télécharger pi_complet.txt */
app.get('/complet', async (req, res) => {
  try {
    const txt = await fs.promises.readFile(COMPLET_FILE, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', 'attachment; filename="pi_complet.txt"');
    res.send(txt);
  } catch (e) {
    if (e.code === 'ENOENT') return res.status(404).send('# Aucun fichier complet.\n');
    res.status(500).send('Erreur.');
  }
});

/* Recherche d'une décimale par rang (1-based) */
app.get('/digit', (req, res) => {
  const rank = parseInt(req.query.rank, 10);
  if (!rank || rank < 1) return res.status(400).json({ error: 'Rang invalide' });
  const idx = rank + 1; // skip "3."
  const digits = continuousState.digits;
  if (idx >= digits.length) {
    return res.json({ rank, digit: null, available: digits.length - 2 });
  }
  res.json({ rank, digit: digits[idx], available: digits.length - 2 });
});

/* Retourne un bloc de ~500 décimales centré sur le rang demandé */
app.get('/digits-around', (req, res) => {
  const rank = parseInt(req.query.rank, 10);
  if (!rank || rank < 1) return res.status(400).json({ error: 'Rang invalide' });

  const digits = continuousState.digits;
  const total = digits.length - 2;
  if (rank > total) {
    return res.json({ rank, block: null, offset: null, total, message: 'Rang non encore calculé' });
  }

  const RADIUS = 500;
  let start = Math.max(0, rank - RADIUS);
  let end = Math.min(total, rank + RADIUS);
  // Aligner start sur multiple de 10 pour que les row-labels soient cohérents
  start = Math.floor(start / 10) * 10;

  const block = digits.slice(2 + start, 2 + end);
  res.json({ rank, block, offset: start, total });
});

/* Recherche d'une chaîne de chiffres dans les snapshots et la mémoire */
app.get('/search-chain', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2 || q.length > 20 || !/^\d+$/.test(q)) {
    return res.status(400).json({ error: 'Chaîne invalide (2–20 chiffres)' });
  }

  const positions = [];
  const digits = continuousState.digits;
  const totalMemory = digits.length - 2;

  // 1. Chercher dans la mémoire live (continuousState.digits)
  if (digits.length > 2) {
    const decPart = digits.slice(2);
    let idx = decPart.indexOf(q);
    while (idx !== -1) {
      positions.push(idx + 1); // rank 1-based
      idx = decPart.indexOf(q, idx + 1);
    }
  }

  // 2. Chercher dans les snapshots sur disque
  try {
    const files = await fs.promises.readdir(DATA_DIR);
    const snapFiles = files
      .filter(f => f.startsWith('pi_') && f.endsWith('.txt') && f !== 'pi_digits.txt' && f !== 'pi_complet.txt' && f !== 'pi_history.log')
      .sort((a, b) => {
        const na = parseInt(a.replace('pi_', '').replace('.txt', ''), 10);
        const nb = parseInt(b.replace('pi_', '').replace('.txt', ''), 10);
        return na - nb;
      });

    for (const f of snapFiles) {
      const n = parseInt(f.replace('pi_', '').replace('.txt', ''), 10);
      // Ne relire que si pas déjà couvert par la mémoire live
      if (n <= totalMemory) continue;
      try {
        const content = await fs.promises.readFile(path.join(DATA_DIR, f), 'utf8');
        const lines = content.split('\n');
        let fileDigits = '';
        for (const line of lines) {
          const t = line.trim();
          if (t && !t.startsWith('#')) { fileDigits = t; break; }
        }
        if (fileDigits.length > 2) {
          const decPart = fileDigits.slice(2);
          let idx = decPart.indexOf(q);
          while (idx !== -1) {
            positions.push(idx + 1);
            idx = decPart.indexOf(q, idx + 1);
          }
        }
      } catch { /* ignore unreadable snapshot */ }
    }
  } catch { /* ignore dir error */ }

  // Dédoublonner et trier
  const unique = [...new Set(positions)].sort((a, b) => a - b);

  res.json({
    query: q,
    positions: unique,
    total_checked: Math.max(totalMemory, 0),
    count: unique.length,
  });
});

/* ── Démarrage + auto-start continu ── */
app.listen(PORT, async () => {
  console.log(`π Explorer en ligne : http://localhost:${PORT}`);
  console.log(`  Pas de calcul : +${STEP.toLocaleString('fr-FR')} décimales par cycle`);

  // Reprendre depuis le disque si pi_complet.txt existe
  await loadContinuousStateFromDisk();

  // Le calcul démarre automatiquement et ne s arrête jamais
  continuousState.running = true;
  continuousState.startTime = Date.now();
  runNextMilestone();
  console.log('▶️  Calcul continu auto-démarré — interruption impossible');
});
