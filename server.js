/**
 * π Explorer — Backend Node.js/Express
 *
 * Deux modes de calcul :
 *   1. Standard   : POST /save + SSE /stream (précision fixe)
 *   2. Continu    : calcul en arrière-plan via milestones,
 *                   snapshots pi_1000.txt … pi_complet.txt
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const { EventEmitter } = require('events');

/* ════════════════════════════════════════════════════════════════════════════
   WORKER — Machin BigInt (même thread, section isolée)
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
const PORT = process.env.PORT || 3000;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pi_digits.txt');
const HISTORY_FILE = path.join(DATA_DIR, 'pi_history.log');
const COMPLET_FILE = path.join(DATA_DIR, 'pi_complet.txt');
const MAX_PRECISION = 1_000_000;
const BLOCK_SIZE = 50;
const BLOCK_DELAY_MS = 150;
const CATCHUP_BLOCK = 500; // blocs plus gros pour le rattrapage continu

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

function clientIp(req) {
  return req.headers['x-forwarded-for']?.split(',')[0].trim()
    || req.socket.remoteAddress || 'unknown';
}

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
  clients: new Set(), // res SSE actifs
};

function snapshotPath(n) {
  return path.join(DATA_DIR, `pi_${n}.txt`);
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

/* ── Envoi des blocs à tous les clients SSE connectés ── */
function broadcast(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of continuousState.clients) {
    try { res.write(data); } catch { continuousState.clients.delete(res); }
  }
}

/* ── Découpage et envoi avec délai entre blocs ── */
function streamDecimalsToClients(decimals, offsetStart, total, milestone, isLive = true) {
  const chunkSize = isLive ? BLOCK_SIZE : CATCHUP_BLOCK;
  const delay = isLive ? BLOCK_DELAY_MS : 20; // catchup ultra-rapide

  let offset = offsetStart;
  let idx = 0;

  const sendNext = () => {
    if (!continuousState.running && isLive) return;
    const block = decimals.slice(idx, idx + chunkSize);
    if (!block) return;
    broadcast('digits', { block, offset, total, milestone });
    idx += block.length;
    offset += block.length;
    if (idx < decimals.length) {
      setTimeout(sendNext, delay);
    }
  };

  sendNext();
}

/* ── Logique du milestone suivant ── */
async function runNextMilestone() {
  if (!continuousState.running) return;

  const nextIdx = continuousState.milestoneIdx + 1;
  if (nextIdx >= MILESTONES.length) {
    continuousState.running = false;
    broadcast('finished', {
      total_decimals: continuousState.digits.length - 2,
      elapsed_ms: Date.now() - continuousState.startTime
    });
    appendHistory(`${new Date().toISOString()} | FINISHED | ${continuousState.digits.length - 2} décimales\n`);
    return;
  }

  const target = MILESTONES[nextIdx];
  const prevLen = continuousState.digits.length - 2;

  broadcast('status', { status: 'computing', milestone: target, current_decimals: prevLen });

  const worker = new Worker(__filename, { workerData: { precision: target } });

  worker.on('message', async ({ digits }) => {
    continuousState.digits = digits;
    continuousState.milestoneIdx = nextIdx;

    const newDec = digits.slice(2 + prevLen); // portion fraîche
    const total = digits.length - 2;

    // Streamer les nouvelles décimales aux clients
    streamDecimalsToClients(newDec, prevLen, total, target, true);

    // Sauvegardes fichiers
    await writeSnapshot(digits, target);
    await writeComplet(digits);
    await appendHistory(`${new Date().toISOString()} | milestone ${target} | ${total} décimales\n`);

    // Notifier milestone atteint
    setTimeout(() => {
      broadcast('milestone', { milestone: target, total_decimals: total });
    }, Math.ceil(newDec.length / BLOCK_SIZE) * BLOCK_DELAY_MS + 100);

    worker.terminate().catch(() => {});

    // Pause puis suite
    setTimeout(() => runNextMilestone(), 1200);
  });

  worker.on('error', (err) => {
    console.error('Continuous worker error:', err);
    continuousState.running = false;
    broadcast('error', { message: err.message });
    worker.terminate().catch(() => {});
  });
}

/* ════════════════════════════════════════════════════════════════════════════
   ROUTES
   ════════════════════════════════════════════════════════════════════════════ */

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

/* ── STANDARD SSE ── */
app.get('/stream', (req, res) => {
  const n = parseInt(req.query.n, 10) || 1000;
  const precision = Math.min(Math.max(n, 1), MAX_PRECISION);
  const ip = clientIp(req);

  const activeStreams = new Map(); // simple local scope
  if (activeStreams.has(ip)) {
    return res.status(429).json({ error: 'Un seul flux par IP.' });
  }
  activeStreams.set(ip, res);

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const t0 = Date.now();
  const worker = new Worker(__filename, { workerData: { precision } });

  worker.on('message', ({ digits }) => {
    const dec = digits.slice(2);
    let offset = 0;
    const iv = setInterval(() => {
      if (offset >= dec.length) {
        clearInterval(iv);
        const elapsed = Date.now() - t0;
        res.write(`event: done\ndata: ${JSON.stringify({ digits, elapsed_ms: elapsed })}\n\n`);
        res.end();
        activeStreams.delete(ip);
        worker.terminate().catch(() => {});
        return;
      }
      const block = dec.slice(offset, offset + BLOCK_SIZE);
      res.write(`event: digits\ndata: ${JSON.stringify({ block, offset, total: dec.length })}\n\n`);
      offset += block.length;
    }, BLOCK_DELAY_MS);

    req.on('close', () => { clearInterval(iv); activeStreams.delete(ip); worker.terminate().catch(() => {}); });
  });

  worker.on('error', (err) => {
    res.write(`event: error\ndata: ${JSON.stringify({ message: err.message })}\n\n`);
    res.end(); activeStreams.delete(ip);
  });
});

/* ── STANDARD digits ── */
app.get('/digits', (req, res) => {
  const n = Math.min(Math.max(parseInt(req.query.n, 10) || 100, 1), MAX_PRECISION);
  const worker = new Worker(__filename, { workerData: { precision: n } });
  worker.on('message', ({ digits }) => {
    res.json({ digits, count: digits.length - 2, computed_at: new Date().toISOString() });
    worker.terminate().catch(() => {});
  });
  worker.on('error', (err) => { res.status(500).json({ error: err.message }); worker.terminate().catch(() => {}); });
});

/* ── SAVE standard ── */
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

/* Démarrer le calcul continu */
app.post('/start-continuous', (req, res) => {
  if (continuousState.running) {
    return res.json({ started: false, reason: 'Déjà en cours', state: continuousState });
  }
  continuousState.running = true;
  continuousState.digits = '3.';
  continuousState.milestoneIdx = -1;
  continuousState.startTime = Date.now();
  runNextMilestone();
  res.json({ started: true, milestones: MILESTONES });
});

/* Arrêter le calcul continu */
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

  // 1) État initial
  res.write(`event: state\ndata: ${JSON.stringify({
    running: continuousState.running,
    total_decimals: continuousState.digits.length - 2,
    current_milestone_idx: continuousState.milestoneIdx,
    next_milestone: MILESTONES[continuousState.milestoneIdx + 1] || null,
    milestones: MILESTONES,
  })}\n\n`);

  // 2) Catch-up : envoyer les décimales déjà calculées en blocs rapides
  const existing = continuousState.digits.slice(2);
  if (existing.length > 0) {
    const milestone = continuousState.milestoneIdx >= 0
      ? MILESTONES[continuousState.milestoneIdx]
      : 0;
    streamDecimalsToClients(existing, 0, existing.length, milestone, false);
  }

  // 3) Nettoyage à la déconnexion
  req.on('close', () => {
    continuousState.clients.delete(res);
    // Le calcul continue même si le client part
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

/* ── Démarrage ── */
app.listen(PORT, () => {
  console.log(`π Explorer en ligne : http://localhost:${PORT}`);
  console.log(`  Mode continu milestones : ${MILESTONES.join(', ')}`);
});
