/**
 * π Explorer — Backend Node.js/Express
 *
 * Mode affichage depuis fichier pi_complet.txt uploadé par un Raspberry.
 * Le serveur ne calcule plus π ; il lit data/pi_complet.txt et diffuse
 * les décimales aux clients en temps réel.
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const { EventEmitter } = require('events');

/* ════════════════════════════════════════════════════════════════════════════
   MAIN THREAD — Serveur Express
   ════════════════════════════════════════════════════════════════════════════ */

const app = express();
const PORT = process.env.PORT || 3001;
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'pi_digits.txt');
const HISTORY_FILE = path.join(DATA_DIR, 'pi_history.log');
const COMPLET_FILE = path.join(DATA_DIR, 'pi_complet.txt');
const SSE_BLOCK_SIZE = 10; // décimales par événement SSE

const PALIERS = [10, 20, 50, 100, 500, 1000, 5000];
function generatePaliers() {
  const max = Number.MAX_SAFE_INTEGER;
  for (let p = 1; p <= max / 10; p *= 10) {
    if (!PALIERS.includes(p)) PALIERS.push(p);
    if (!PALIERS.includes(5 * p)) PALIERS.push(5 * p);
  }
  PALIERS.sort((a, b) => a - b);
}
generatePaliers();

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
   MODE FICHIER — Lecture de pi_complet.txt + SSE
   ════════════════════════════════════════════════════════════════════════════ */
const fileEmitter = new EventEmitter();
fileEmitter.setMaxListeners(100);

let piDigits = '3.';
let piTotal = 0;
let piLastModified = null;
let fileClients = new Set();
let fileWatchers = [];

function snapshotPath(n) {
  return path.join(DATA_DIR, `pi_${n}.txt`);
}

function completFileForTotal(n) {
  return path.join(DATA_DIR, `pi_${n}.txt`);
}

function resolveCompletFile() {
  // Si pi_complet.txt existe, il reste la source principale (compat)
  if (fs.existsSync(COMPLET_FILE)) return COMPLET_FILE;

  // Sinon, chercher le plus grand pi_NNN.txt cohérent
  try {
    const files = fs.readdirSync(DATA_DIR);
    let best = null, bestTotal = 0;
    for (const f of files) {
      const m = f.match(/^pi_(\d+)\.txt$/);
      if (!m) continue;
      const n = parseInt(m[1], 10);
      const candidate = path.join(DATA_DIR, f);
      const { total } = readPiFileSync(candidate);
      if (total >= bestTotal) {
        bestTotal = total;
        best = candidate;
      }
    }
    if (best) return best;
  } catch {}
  return COMPLET_FILE; // fallback
}

function readPiFileSync(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');
    let total = 0;
    let digits = '3.';

    for (const line of lines) {
      if (/^#\s*Nombre total de d[eé]cimales\s*:/i.test(line)) {
        total = parseInt(line.split(':')[1].trim().replace(/,/g, ''), 10) || 0;
      }
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('3.') || trimmed.startsWith('-3.') || /^-?\d+\.\d+$/.test(trimmed)) {
        digits = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
        break;
      }
    }

    const effectiveTotal = Math.max(total, digits.length - 2);
    return { digits, total: effectiveTotal, lastModified: fs.statSync(filePath).mtime.toISOString() };
  } catch (e) {
    if (e.code === 'ENOENT') return { digits: '3.', total: 0, lastModified: null };
    throw e;
  }
}

async function appendHistory(line) {
  await fs.promises.appendFile(HISTORY_FILE, line, 'utf8').catch(() => {});
}

/* ── Lecture d'un fichier pi (synchrone ou asynchrone) ── */
async function readPiFile(filePath) {
  try {
    const content = await fs.promises.readFile(filePath, 'utf8');
    const lines = content.split('\n');
    let digits = '3.';
    let total = 0;

    for (const line of lines) {
      if (/^#\s*Nombre total de d[eé]cimales\s*:/i.test(line)) {
        total = parseInt(line.split(':')[1].trim().replace(/,/g, ''), 10) || 0;
      }
    }

    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith('3.') || trimmed.startsWith('-3.') || /^-?\d+\.\d+$/.test(trimmed)) {
        digits = trimmed.startsWith('-') ? trimmed.slice(1) : trimmed;
        break;
      }
    }

    return { digits, total: Math.max(total, digits.length - 2) };
  } catch (e) {
    if (e.code === 'ENOENT') return { digits: '3.', total: 0 };
    throw e;
  }
}

async function readPiComplet() {
  const filePath = resolveCompletFile();
  return readPiFile(filePath);
}

/* ── Mise à jour de l'état depuis le fichier ── */
async function refreshPiFromFile() {
  const filePath = resolveCompletFile();
  try {
    const st = await fs.promises.stat(filePath);
    const mtime = st.mtime.toISOString();
    if (piLastModified === mtime) return false; // pas de changement
    piLastModified = mtime;

    const { digits, total } = await readPiComplet();
    const oldTotal = piTotal;
    piDigits = digits;
    piTotal = total;

    if (total > oldTotal) {
      console.log(`📄 ${path.basename(filePath)} mis à jour : ${total.toLocaleString('fr-FR')} décimales (+${total - oldTotal})`);
      await appendHistory(`${new Date().toISOString()} | FILE | ${total} décimales depuis ${path.basename(filePath)}\n`);
      await ensureSnapshots(digits, total);
      streamNewFileDigits(oldTotal, total);
    }
    return true;
  } catch (e) {
    console.error('Erreur refreshPiFromFile :', e.message);
    return false;
  }
}

/* ── Générer / mettre à jour les snapshots de paliers ── */
async function ensureSnapshots(digits, total) {
  const promises = [];
  for (const n of PALIERS) {
    if (n > total) break;
    const sp = snapshotPath(n);
    if (fs.existsSync(sp)) continue;
    const slice = digits.slice(0, 2 + n);
    const header = [
      '# Pi Digits made with ♥ by PI Explorer',
      `# Généré le : ${new Date().toISOString()}`,
      `# Nombre total de décimales : ${n}`,
      '# Source : pi_complet.txt uploadé par Raspberry',
      '#',
      slice,
      ''
    ].join('\n');
    promises.push(fs.promises.writeFile(sp, header, 'utf8'));
  }
  if (promises.length) {
    await Promise.all(promises);
    broadcastFile('milestone', { total_decimals: total });
  }
}

/* ── Broadcast SSE aux clients fichier ── */
function broadcastFile(event, payload) {
  const data = `event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const res of fileClients) {
    try { res.write(data); } catch { fileClients.delete(res); }
  }
}

/* ── Streamer les nouvelles décimales depuis le fichier ── */
function streamNewFileDigits(from, to) {
  const decimals = piDigits.slice(2 + from, 2 + to);
  if (!decimals) return;

  for (let offset = from; offset < to; offset += SSE_BLOCK_SIZE) {
    const block = decimals.slice(offset - from, offset - from + SSE_BLOCK_SIZE);
    setTimeout(() => {
      broadcastFile('digits', { block, offset, total: piTotal });
    }, ((offset - from) / SSE_BLOCK_SIZE) * 25);
  }
}

/* ── Surveillance du fichier ── */
function watchPiFile() {
  const filePath = resolveCompletFile();
  // fs.watch est capricieux sur certains FS : on combine avec un polling
  try {
    const watcher = fs.watch(filePath, async (eventType) => {
      if (eventType === 'change') await refreshPiFromFile();
    });
    fileWatchers.push(watcher);
  } catch (e) {
    console.warn(`fs.watch indisponible sur ${path.basename(filePath)} :`, e.message);
  }

  // Polling de secours toutes les 2 secondes
  const poll = setInterval(() => refreshPiFromFile(), 2000);
  fileWatchers.push({ close: () => clearInterval(poll) });
}

/* ── Chargement initial ── */
async function loadPiFile() {
  const filePath = resolveCompletFile();
  const { digits, total, lastModified } = readPiFileSync(filePath);
  piDigits = digits;
  piTotal = total;
  piLastModified = lastModified;
  if (total > 0) {
    await ensureSnapshots(digits, total);
    console.log(`📄 Chargement initial : ${total.toLocaleString('fr-FR')} décimales depuis ${path.basename(filePath)}`);
  } else {
    console.log('🆕 Aucun fichier pi trouvé — en attente d upload Raspberry');
  }
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
      '# Source : sauvegarde manuelle',
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
  const filePath = resolveCompletFile();
  try {
    const st = await fs.promises.stat(filePath);
    const txt = await fs.promises.readFile(filePath, 'utf8');
    let total = 0, last = null;
    for (const l of txt.split('\n')) {
      if (/^#\s*Nombre total de d[eé]cimales\s*:/i.test(l)) total = parseInt(l.split(':')[1].trim().replace(/,/g, ''), 10) || 0;
      if (/^#\s*Derni[eè]re mise [aà] jour\s*:/i.test(l)) last = new Date(l.split(':').slice(1).join(':').trim()).toISOString();
    }
    const digitsLine = txt.split('\n').find(l => l.trim().startsWith('3.') || l.trim().startsWith('-3.') || /^-?\d+\.\d+$/.test(l.trim()));
    const effectiveTotal = Math.max(total, digitsLine ? digitsLine.trim().replace(/^-/, '').length - 2 : 0);
    res.json({
      total_digits_stored: effectiveTotal,
      last_modified: last || piLastModified,
      file_size_kb: Math.round(st.size / 1024 * 10) / 10,
      source_file: path.basename(filePath),
    });
  } catch (e) {
    if (e.code === 'ENOENT') return res.json({ total_digits_stored: piTotal, last_modified: piLastModified, file_size_kb: 0, source_file: path.basename(filePath) });
    res.status(500).json({ error: 'Erreur' });
  }
});

/* ════════════════════════════════════════════════════════════════════════════
   ROUTES MODE FICHIER
   ════════════════════════════════════════════════════════════════════════════ */

/* Forcer un refresh manuel du fichier */
app.post('/refresh-file', async (req, res) => {
  const ok = await refreshPiFromFile();
  res.json({ refreshed: ok, total_digits: piTotal });
});

/* État du fichier pi_complet.txt */
app.get('/continuous-state', (req, res) => {
  res.json({
    running: true,
    total_decimals: piTotal,
    source: 'pi_complet.txt',
    last_modified: piLastModified,
  });
});

/* SSE fichier — rattrapage puis live */
app.get('/stream-continuous', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  fileClients.add(res);

  // État initial
  res.write(`event: state\ndata: ${JSON.stringify({
    running: true,
    total_decimals: piTotal,
    source: 'pi_complet.txt',
  })}\n\n`);

  // Catch-up : envoyer les 1 000 dernières décimales rapidement
  const existing = piDigits.slice(2);
  if (existing.length > 0) {
    const TAIL = Math.min(1000, existing.length);
    const tail = existing.slice(-TAIL);
    const offsetStart = existing.length - TAIL;
    for (let i = 0; i < tail.length; i += SSE_BLOCK_SIZE) {
      const block = tail.slice(i, i + SSE_BLOCK_SIZE);
      setTimeout(() => {
        try {
          res.write(`event: digits\ndata: ${JSON.stringify({
            block,
            offset: offsetStart + i,
            total: piTotal,
          })}\n\n`);
        } catch { fileClients.delete(res); }
      }, (i / SSE_BLOCK_SIZE) * 15);
    }
  }

  // Heartbeat toutes les 30s
  const ping = setInterval(() => {
    try {
      res.write(':ping\n\n');
    } catch {
      clearInterval(ping);
      fileClients.delete(res);
    }
  }, 30000);

  req.on('close', () => {
    clearInterval(ping);
    fileClients.delete(res);
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
  const filePath = resolveCompletFile();
  try {
    const txt = await fs.promises.readFile(filePath, 'utf8');
    res.setHeader('Content-Type', 'text/plain');
    res.setHeader('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`);
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
  const digits = piDigits;
  if (idx >= digits.length) {
    return res.json({ rank, digit: null, available: digits.length - 2 });
  }
  res.json({ rank, digit: digits[idx], available: digits.length - 2 });
});

/* Retourne un bloc de ~500 décimales centré sur le rang demandé */
app.get('/digits-around', (req, res) => {
  const rank = parseInt(req.query.rank, 10);
  if (!rank || rank < 1) return res.status(400).json({ error: 'Rang invalide' });

  const digits = piDigits;
  const total = digits.length - 2;
  if (rank > total) {
    return res.json({ rank, block: null, offset: null, total, message: 'Rang non encore disponible' });
  }

  const RADIUS = 500;
  let start = Math.max(0, rank - RADIUS);
  let end = Math.min(total, rank + RADIUS);
  start = Math.floor(start / 10) * 10;

  const block = digits.slice(2 + start, 2 + end);
  res.json({ rank, block, offset: start, total });
});

/* Recherche d'une chaîne de chiffres dans pi_complet.txt */
app.get('/search-chain', async (req, res) => {
  const q = (req.query.q || '').trim();
  if (!q || q.length < 2 || q.length > 20 || !/^\d+$/.test(q)) {
    return res.status(400).json({ error: 'Chaîne invalide (2–20 chiffres)' });
  }

  const positions = [];
  const digits = piDigits;
  const totalAvailable = digits.length - 2;

  if (digits.length > 2) {
    const decPart = digits.slice(2);
    let idx = decPart.indexOf(q);
    while (idx !== -1) {
      positions.push(idx + 1); // rank 1-based
      idx = decPart.indexOf(q, idx + 1);
    }
  }

  const unique = [...new Set(positions)].sort((a, b) => a - b);

  res.json({
    query: q,
    positions: unique,
    total_checked: Math.max(totalAvailable, 0),
    count: unique.length,
  });
});

/* ── Démarrage — mode lecture fichier ── */
app.listen(PORT, async () => {
  console.log(`π Explorer en ligne : http://localhost:${PORT}`);
  console.log('  Mode : affichage depuis pi_complet.txt / pi_N.txt (uploadé par le Raspberry)');

  await loadPiFile();
  watchPiFile();
});
