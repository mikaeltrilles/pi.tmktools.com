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
   WORKER — Machin BigInt
   ════════════════════════════════════════════════════════════════════════════ */
if (!isMainThread) {
  const { precision } = workerData;

  function arctanDiv(scale, n) {
    const n2 = BigInt(n * n);
    let sum = scale / BigInt(n);
    let term = sum;
    let i = 3n;
    let sign = -1n;
    while (true) {
      term = term / n2;
      const next = term / i;
      if (next === 0n) break;
      sum += sign * next;
      sign = -sign;
      i += 2n;
    }
    return sum;
  }

  const extra = 10;
  const scale = 10n ** BigInt(precision + extra);
  const atan5 = arctanDiv(scale, 5);
  const atan239 = arctanDiv(scale, 239);
  const pi = 4n * (4n * atan5 - atan239);
  const s = pi.toString();
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
const BLOCK_SIZE = 50;
const BLOCK_DELAY_MS = 150;
const CATCHUP_BLOCK = 500;

const MILESTONES = [
  100, 500, 1000, 5000, 10000,
  50000, 100000, 200000, 500000, 1000000
];

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

function ensureNextMilestone() {
  const last = MILESTONES[MILESTONES.length - 1];
  const next = last * 2; // x2 à chaque fois : 1M → 2M → 4M → 8M …
  MILESTONES.push(next);
  console.log(`📈 Nouveau milestone ajouté : ${next.toLocaleString('fr-FR')}`);
}

async function writeSnapshot(digits, n) {
  const header = [
    `# Pi Snapshot — ${n} décimales`,
    `# Généré le : ${new Date().toISOString()}`,
    `# Nombre de décimales : ${digits.length - 2}`,
    '# Algorithme : Machin (BigInt)',
    '#',
    digits,
    ''
  ].join('\n');
  await fs.promises.writeFile(snapshotPath(n), header, 'utf8');
}

async function writeComplet(digits) {
  const header = [
    '# Pi Complet — Accumulation continue',
    `# Dernière mise à jour : ${new Date().toISOString()}`,
    `# Nombre total de décimales : ${digits.length - 2}`,
    '# Algorithme : Machin (BigInt)',
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

      // Trouver l index du dernier milestone atteint
      let idx = -1;
      for (let i = 0; i < MILESTONES.length; i++) {
        if (MILESTONES[i] <= total) idx = i;
        else break;
      }

      // Si on a dépassé tous les milestones existants, en générer de nouveaux
      while (total >= MILESTONES[MILESTONES.length - 1]) {
        ensureNextMilestone();
        idx = MILESTONES.length - 1;
      }

      continuousState.milestoneIdx = idx;
      console.log(`⏮️  Reprise depuis disque : ${total.toLocaleString('fr-FR')} décimales (milestone idx ${idx})`);
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

/* ── Logique du milestone suivant (infini) ── */
async function runNextMilestone() {
  if (!continuousState.running) return;

  let nextIdx = continuousState.milestoneIdx + 1;

  // Générer des milestones à l infini si besoin
  if (nextIdx >= MILESTONES.length) {
    ensureNextMilestone();
    nextIdx = continuousState.milestoneIdx + 1;
  }

  const target = MILESTONES[nextIdx];
  const prevLen = continuousState.digits.length - 2;

  broadcast('status', { status: 'computing', milestone: target, current_decimals: prevLen });

  const worker = new Worker(__filename, { workerData: { precision: target } });

  worker.on('message', async ({ digits }) => {
    continuousState.digits = digits;
    continuousState.milestoneIdx = nextIdx;

    const newDec = digits.slice(2 + prevLen);
    const total = digits.length - 2;

    // Streamer les nouvelles décimales aux clients
    streamDecimalsToClients(newDec, prevLen, total, target, true, prevLen);

    // Sauvegardes fichiers
    await writeSnapshot(digits, target);
    await writeComplet(digits);
    await appendHistory(`${new Date().toISOString()} | milestone ${target} | ${total} décimales\n`);

    // Notifier milestone atteint
    setTimeout(() => {
      broadcast('milestone', { milestone: target, total_decimals: total });
    }, Math.ceil(newDec.length / BLOCK_SIZE) * BLOCK_DELAY_MS + 100);

    worker.terminate().catch(() => {});

    // Pause puis suite — le calcul ne s arrête jamais
    setTimeout(() => runNextMilestone(), 1200);
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
      '# Pi Digits — pi.tmktools.com',
      `# Généré le : ${new Date().toISOString()}`,
      `# Nombre de décimales : ${digits.length - 2}`,
      '# Algorithme : Machin (BigInt)',
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
    const st = await fs.promises.stat(DATA_FILE);
    const txt = await fs.promises.readFile(DATA_FILE, 'utf8');
    let total = 0, last = null;
    for (const l of txt.split('\n')) {
      if (l.startsWith('# Nombre de décimales :')) total = parseInt(l.split(':')[1].trim(), 10) || 0;
      if (l.startsWith('# Généré le :')) last = new Date(l.split(':').slice(1).join(':').trim()).toISOString();
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
  res.json({ started: true, milestones: MILESTONES });
});

/* Arrêter — route gardée pour admin d urgence, mais le calcul redémarre auto */
app.post('/stop-continuous', (req, res) => {
  continuousState.running = false;
  broadcast('stopped', { total_decimals: continuousState.digits.length - 2 });
  res.json({ stopped: true, total_decimals: continuousState.digits.length - 2 });
});

/* État du calcul continu */
app.get('/continuous-state', (req, res) => {
  res.json({
    running: continuousState.running,
    total_decimals: continuousState.digits.length - 2,
    current_milestone_idx: continuousState.milestoneIdx,
    next_milestone: MILESTONES[continuousState.milestoneIdx + 1] || null,
    milestones: MILESTONES,
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

  // État initial
  res.write(`event: state\ndata: ${JSON.stringify({
    running: continuousState.running,
    total_decimals: continuousState.digits.length - 2,
    current_milestone_idx: continuousState.milestoneIdx,
    next_milestone: MILESTONES[continuousState.milestoneIdx + 1] || null,
    milestones: MILESTONES,
  })}\n\n`);

  // Catch-up limité aux 1 000 dernières décimales pour que la grille
  // ne soit jamais vide au moment de la connexion, sans saturer le navigateur.
  const existing = continuousState.digits.slice(2);
  if (existing.length > 0) {
    const TAIL = 1000;
    const tail = existing.slice(-TAIL);
    const milestone = continuousState.milestoneIdx >= 0
      ? MILESTONES[continuousState.milestoneIdx]
      : 0;
    const offsetStart = existing.length - tail.length;
    streamDecimalsToClients(tail, offsetStart, existing.length, milestone, false, offsetStart);
  }

  req.on('close', () => {
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

/* ── Démarrage + auto-start continu ── */
app.listen(PORT, async () => {
  console.log(`π Explorer en ligne : http://localhost:${PORT}`);
  console.log(`  Milestones : ${MILESTONES.slice(0, 10).join(', ')}…`);

  // Reprendre depuis le disque si pi_complet.txt existe
  await loadContinuousStateFromDisk();

  // Le calcul démarre automatiquement et ne s arrête jamais
  continuousState.running = true;
  continuousState.startTime = Date.now();
  runNextMilestone();
  console.log('▶️  Calcul continu auto-démarré — interruption impossible');
});
