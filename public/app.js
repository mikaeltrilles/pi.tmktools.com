/* ════════════════════════════════════════════════════════════════════════════
   Pi — Logique du frontend (retranscription en direct depuis pi_complet.txt)
   ════════════════════════════════════════════════════════════════════════════ */
(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const fmt = (n) => Number(n).toLocaleString('fr-FR');

  /* ── Thème (même logique que phi.tmktools.com) ── */
  const THEME_KEY = 'pi-theme';
  const systemTheme = () => (window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const currentTheme = () => {
    const t = document.documentElement.dataset.theme;
    return t === 'light' || t === 'dark' ? t : systemTheme();
  };
  function applyTheme(theme) {
    document.documentElement.dataset.theme = theme;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = theme === 'light' ? '#f6f4ee' : '#0b0f14';
  }
  function setupThemeToggle(button) {
    const refreshLabel = () => {
      const label = currentTheme() === 'light' ? 'Passer au thème sombre' : 'Passer au thème clair';
      button.setAttribute('aria-label', label);
      button.title = label;
    };
    button.addEventListener('click', () => {
      const next = currentTheme() === 'light' ? 'dark' : 'light';
      applyTheme(next);
      try { localStorage.setItem(THEME_KEY, next); } catch {}
      refreshLabel();
    });
    window.matchMedia?.('(prefers-color-scheme: light)').addEventListener('change', () => {
      let stored = null;
      try { stored = localStorage.getItem(THEME_KEY); } catch {}
      if (!stored) { applyTheme(systemTheme()); refreshLabel(); }
    });
    refreshLabel();
  }

  /* ── Notifications ── */
  const toastTimers = new Map();
  function toast(message, kind = 'info') {
    const key = `${kind}|${message}`;
    const existing = toastTimers.get(key);
    if (existing) {
      clearTimeout(existing);
      toastTimers.delete(key);
      $('toastBox').querySelector(`[data-key="${CSS.escape(key)}"]`)?.remove();
    }
    const el = document.createElement('div');
    el.className = `toast toast-${kind}`;
    el.dataset.key = key;
    el.textContent = message;
    $('toastBox').appendChild(el);
    requestAnimationFrame(() => el.classList.add('on'));
    const timer = setTimeout(() => {
      el.classList.remove('on');
      setTimeout(() => { el.remove(); toastTimers.delete(key); }, 300);
    }, 3500);
    toastTimers.set(key, timer);
  }

  /* ── État ── */
  let es = null;
  let count = 0;
  let currentRow = null;
  let currentRowStartRank = 1;
  let rowCellCount = 0;
  let liveCounterCurrent = 0;
  let liveCounterTarget = 0;
  let digitQueue = [];
  let digitRenderTimer = null;
  let latestDigitEl = null;
  const DIGIT_RENDER_DELAY = 45;
  let firstLoadComplete = false;
  let catchUpRemaining = 0;
  let serverDistribution = new Array(10).fill(0);
  let serverTotalDigits = 0;
  let reconnectDelay = 2000;
  let reconnectTimer = null;
  let intentionalClose = false;
  let statePoll = null;

  /* ── Badges d'état ── */
  function setStatus(state) {
    const b = $('statusBadge');
    b.className = 'badge ' + ({ live: 'on', connected: 'ok', error: 'warn', idle: '' }[state] || '');
    $('statusText').textContent = { live: 'Retranscription en direct', connected: 'Connecté', error: 'Erreur', idle: 'Hors ligne' }[state] || 'Hors ligne';
  }

  async function updateCalculatorStatus() {
    const b = $('calcBadge');
    try {
      const r = await fetch('/api/health/data', { cache: 'no-store' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const data = await r.json();
      const calc = data.connections.calculator_to_server;
      const cls = calc.status === 'connected' ? 'ok' : (calc.status === 'stale' ? 'warn' : '');
      b.className = 'badge' + (cls ? ' ' + cls : '');
      $('calcStatusText').textContent = calc.status === 'connected' ? 'Calcul actif'
        : calc.status === 'stale' ? 'Calcul en pause'
        : 'Calcul : inconnu';
      const seen = calc.last_seen_at ? new Date(calc.last_seen_at).toLocaleString('fr-FR') : 'aucun signal reçu';
      b.title = `Dernier signal du calculateur : ${seen}${calc.stage ? ' · ' + calc.stage : ''} — voir le détail`;
    } catch {
      b.className = 'badge';
      $('calcStatusText').textContent = 'Calcul : inconnu';
      b.title = 'Impossible de joindre le service de statut — voir le détail';
    }
  }

  /* ── Nombre en lettres (compteur) ── */
  function nombreEnLettres(n) {
    if (n === 0) return 'zéro';
    const unit = ['', 'un', 'deux', 'trois', 'quatre', 'cinq', 'six', 'sept', 'huit', 'neuf'];
    const dizaine = ['', 'dix', 'vingt', 'trente', 'quarante', 'cinquante', 'soixante', 'soixante', 'quatre-vingt', 'quatre-vingt'];
    const teens = ['dix', 'onze', 'douze', 'treize', 'quatorze', 'quinze', 'seize', 'dix-sept', 'dix-huit', 'dix-neuf'];
    const groupes = [['', ''], ['mille', 'mille'], ['million', 'millions'], ['milliard', 'milliards'], ['billion', 'billions'], ['billiard', 'billiards'], ['trillion', 'trillions']];
    function conv(m, isFinal = false) {
      if (m < 10) return unit[m];
      if (m < 20) return teens[m - 10];
      if (m < 70) {
        const d = Math.floor(m / 10), u = m % 10;
        return u === 1 ? dizaine[d] + '-et-un' : dizaine[d] + (u > 0 ? '-' + unit[u] : '');
      }
      if (m < 80) { const r = m - 60; return r === 1 ? 'soixante-et-onze' : 'soixante-' + conv(r); }
      if (m < 100) { const r = m - 80; return r === 1 ? 'quatre-vingt-un' : 'quatre-vingt' + (r > 0 ? '-' + conv(r) : 's'); }
      if (m < 1000) {
        const c = Math.floor(m / 100), r = m % 100;
        const centStr = c > 1 ? unit[c] + ' cent' : 'cent';
        if (r > 0) return centStr + ' ' + conv(r);
        if (!isFinal) return centStr;
        return c > 1 ? centStr + 's' : centStr;
      }
      const parts = [];
      let reste = m;
      while (reste > 0) { parts.push(reste % 1000); reste = Math.floor(reste / 1000); }
      let result = '';
      for (let i = parts.length - 1; i >= 0; i--) {
        const val = parts[i];
        if (val === 0) continue;
        let piece;
        if (i === 0) piece = conv(val, true);
        else if (i === 1) piece = val > 1 ? conv(val) + ' mille' : 'mille';
        else { const [sg, pl] = groupes[i] || ['', '']; if (!sg) continue; piece = val > 1 ? conv(val) + ' ' + pl : 'un ' + sg; }
        result = result ? result + ' ' + piece : piece;
      }
      return result || 'zéro';
    }
    return conv(n, true);
  }

  /* ── Compteur ── */
  function updateLiveCounterDOM(n) {
    $('liveCounter').textContent = fmt(n);
    $('liveCounterWords').textContent = nombreEnLettres(n);
  }

  /* ── Dernière décimale ── */
  let lastDigitTimer = null;
  function showLastDigit(ch, rank) {
    const box = $('lastDigit');
    const v = $('lastDigitValue');
    v.textContent = ch;
    v.className = 'last-digit-value v' + ch;
    $('lastDigitRank').textContent = `Rang #${fmt(rank)}`;
    box.classList.add('on');
    if (lastDigitTimer) clearTimeout(lastDigitTimer);
    lastDigitTimer = setTimeout(() => box.classList.remove('on'), 2200);
  }

  /* ── Grille ── */
  function ensureRow() {
    if (currentRow && rowCellCount < 10) return;
    if (currentRowStartRank > 1 && (currentRowStartRank - 1) % 100 === 0) {
      const sep = document.createElement('div');
      sep.className = 'century-rule';
      sep.innerHTML = '<div class="line"></div><div class="text">' + fmt(currentRowStartRank - 1) + '</div><div class="line"></div>';
      $('piStage').appendChild(sep);
    }
    currentRow = document.createElement('div');
    currentRow.className = 'pi-row';
    const label = document.createElement('span');
    label.className = 'row-label';
    label.textContent = currentRowStartRank;
    currentRow.appendChild(label);
    $('piStage').appendChild(currentRow);
    rowCellCount = 0;
  }

  function makeCell(ch, rank, animate) {
    const cell = document.createElement('span');
    cell.className = 'pi-cell';
    const digit = document.createElement('span');
    digit.className = 'pi-digit v' + ch + (animate ? ' new' : '');
    digit.textContent = ch;
    digit.dataset.rank = rank;
    if (animate) setTimeout(() => digit.classList.remove('new'), 200);
    const rk = document.createElement('span');
    rk.className = 'pi-rank';
    rk.textContent = rank;
    cell.appendChild(digit);
    cell.appendChild(rk);
    return { cell, digit };
  }

  function markLatest(digit) {
    if (latestDigitEl) latestDigitEl.classList.remove('latest');
    latestDigitEl = digit;
    requestAnimationFrame(() => digit.classList.add('latest'));
  }

  function appendBlockFast(block, offset) {
    let last = null;
    for (let i = 0; i < block.length; i++) {
      const ch = block[i];
      const rank = offset + i + 1;
      ensureRow();
      const { cell, digit } = makeCell(ch, rank, false);
      currentRow.appendChild(cell);
      last = digit;
      count++;
      rowCellCount++;
      if (rowCellCount >= 10) currentRowStartRank = rank + 1;
      liveCounterCurrent = rank;
      liveCounterTarget = Math.max(liveCounterTarget, rank);
    }
    if (last) markLatest(last);
    updateLiveCounterDOM(liveCounterCurrent);
    scrollToLatest();
  }

  function renderNextDigit() {
    if (digitQueue.length === 0) return;
    const { ch, rank } = digitQueue.shift();
    ensureRow();
    const { cell, digit } = makeCell(ch, rank, true);
    currentRow.appendChild(cell);
    markLatest(digit);
    count++;
    rowCellCount++;
    if (rowCellCount >= 10) currentRowStartRank = rank + 1;
    liveCounterCurrent = rank;
    liveCounterTarget = Math.max(liveCounterTarget, rank);
    updateLiveCounterDOM(rank);
    showLastDigit(ch, rank);
    scrollToLatest();
  }

  function scheduleRenderNextDigit() {
    if (digitQueue.length === 0) { digitRenderTimer = null; return; }
    digitRenderTimer = setTimeout(() => { renderNextDigit(); scheduleRenderNextDigit(); }, DIGIT_RENDER_DELAY);
  }

  function appendBlock(block, offset, totalFromServer = 0) {
    if (!firstLoadComplete) {
      catchUpRemaining += block.length;
      appendBlockFast(block, offset);
      if (liveCounterCurrent >= totalFromServer - 1 || catchUpRemaining >= totalFromServer) firstLoadComplete = true;
    } else {
      for (let i = 0; i < block.length; i++) digitQueue.push({ ch: block[i], rank: offset + i + 1 });
      if (!digitRenderTimer) scheduleRenderNextDigit();
    }
  }

  function scrollToLatest() {
    if (latestDigitEl) latestDigitEl.scrollIntoView({ behavior: 'smooth', block: 'nearest', inline: 'nearest' });
  }

  async function scrollToRank(rank) {
    const glow = (el) => {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      el.parentElement.classList.add('search-glow');
      setTimeout(() => el.parentElement.classList.remove('search-glow'), 2500);
    };
    const target = document.querySelector(`.pi-digit[data-rank="${rank}"]`);
    if (target) { glow(target); return; }
    toast(`Chargement de la zone autour de la décimale n°${fmt(rank)}…`, 'info');
    try {
      const r = await fetch(`/digits-around?rank=${rank}`);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { block, offset } = await r.json();
      if (!block) { toast('Rang non encore disponible.', 'error'); return; }
      $('piStage').innerHTML = '';
      count = 0;
      currentRow = null; currentRowStartRank = offset + 1; rowCellCount = 0;
      appendBlockFast(block, offset);
      const el = document.querySelector(`.pi-digit[data-rank="${rank}"]`);
      if (el) glow(el);
    } catch (err) {
      toast(`Impossible de charger la zone : ${err.message}`, 'error');
    }
  }
  window.scrollToRank = scrollToRank;

  /* ── Distribution ── */
  let distRafPending = false;
  function renderDist() {
    const box = $('distBox');
    if (serverTotalDigits === 0 || serverDistribution.every((c) => c === 0)) {
      box.innerHTML = '<p class="tool-out">En attente du fichier π…</p>';
      return;
    }
    const total = Math.max(serverTotalDigits, 1);
    const rows = serverDistribution.map((c, d) => ({ d, c, pct: (c / total) * 100 })).sort((a, b) => b.pct - a.pct);
    box.innerHTML = rows.map(({ d, c, pct }) => `
      <div class="dist-row" title="${fmt(c)} occurrences">
        <span class="dist-label v${d}">${d}</span>
        <div class="dist-track"><div class="dist-fill v${d}" style="width:${Math.min(100, pct * 2)}%"></div></div>
        <span class="dist-count">${pct.toFixed(2)} %</span>
      </div>`).join('');
  }
  function scheduleRenderDist() {
    if (distRafPending) return;
    distRafPending = true;
    requestAnimationFrame(() => { renderDist(); distRafPending = false; });
  }

  /* ── Snapshots ── */
  async function loadSnapshots() {
    try {
      const { snapshots } = await (await fetch('/snapshots')).json();
      if (!snapshots.length) { $('snapshotList').innerHTML = '<p class="tool-out">Aucun snapshot.</p>'; return; }
      $('snapshotList').innerHTML = snapshots.slice().reverse().map((s) => `
        <div class="snapshot-row" title="Snapshot π — ${fmt(s.n)} décimales">
          <span class="n">${fmt(s.n)}</span>
          <span class="unit">décimales</span>
          <a class="btn btn-secondary btn-sm" href="/snapshot/${s.n}" download="pi_${s.n}.txt"><span aria-hidden="true">⬇</span> Télécharger</a>
        </div>`).join('');
    } catch { $('snapshotList').innerHTML = ''; }
  }

  /* ── Infos fichier ── */
  async function updateStorage() {
    try {
      const { total_digits_stored, last_modified, source_file, file_size_kb } = await (await fetch('/stats')).json();
      $('storedCount').textContent = total_digits_stored > 0 ? fmt(total_digits_stored) : '—';
      $('storedDate').textContent = last_modified ? new Date(last_modified).toLocaleString('fr-FR') : '—';
      if (source_file) $('storedFile').textContent = source_file;
      if (file_size_kb) $('storedSize').textContent = file_size_kb > 1024 ? `${(file_size_kb / 1024).toFixed(1)} Mo` : `${Math.round(file_size_kb)} Ko`;
      $('liveMeta').textContent = last_modified
        ? `Source : ${source_file || 'pi_complet.txt'} · mis à jour le ${new Date(last_modified).toLocaleString('fr-FR')}`
        : 'En attente du fichier π…';
    } catch {}
  }

  /* ── Connexion SSE ── */
  function applyState(st) {
    serverTotalDigits = st.total_decimals || 0;
    if (Array.isArray(st.distribution) && st.distribution.length === 10) serverDistribution = st.distribution;
    scheduleRenderDist();
    liveCounterCurrent = serverTotalDigits;
    liveCounterTarget = serverTotalDigits;
    updateLiveCounterDOM(serverTotalDigits);
  }

  function connectFileStream() {
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (es) { try { es.close(); } catch {} }
    setStatus('live');

    fetch('/continuous-state').then((r) => r.json()).then(applyState).catch(() => {});

    es = new EventSource('/stream-continuous');
    es.addEventListener('state', (e) => { applyState(JSON.parse(e.data)); renderDist(); });
    es.addEventListener('digits', (e) => {
      const { block, offset, total } = JSON.parse(e.data);
      appendBlock(block, offset, total);
    });
    es.addEventListener('milestone', (e) => {
      const { total_decimals } = JSON.parse(e.data);
      serverTotalDigits = total_decimals;
      loadSnapshots();
      toast(`${fmt(total_decimals)} décimales disponibles`, 'ok');
    });
    es.addEventListener('reload', (e) => {
      const st = JSON.parse(e.data);
      applyState(st);
      toast(`Nouveau fichier détecté (${fmt(st.total_decimals)} décimales) — rechargement…`, 'info');
      setTimeout(() => window.location.reload(), 1200);
    });
    es.addEventListener('reset', () => { toast('Fichier réécrit — resynchronisation…', 'info'); hardReset(); });
    es.onopen = () => { reconnectDelay = 2000; setStatus('connected'); };
    es.onerror = () => {
      if (es && es.readyState === EventSource.CLOSED) {
        if (intentionalClose) { intentionalClose = false; return; }
        setStatus('idle');
        reconnectDelay = Math.min(reconnectDelay * 1.5, 30000);
        reconnectTimer = setTimeout(connectFileStream, reconnectDelay);
      } else {
        setStatus('live');
      }
    };

    if (statePoll) clearInterval(statePoll);
    statePoll = setInterval(() => {
      fetch('/continuous-state').then((r) => r.json()).then((st) => {
        serverTotalDigits = st.total_decimals || 0;
        if (Array.isArray(st.distribution) && st.distribution.length === 10) serverDistribution = st.distribution;
        renderDist();
      }).catch(() => {});
    }, 3000);
  }

  /* ── Resync ── */
  async function hardReset() {
    intentionalClose = true;
    if (reconnectTimer) { clearTimeout(reconnectTimer); reconnectTimer = null; }
    if (digitRenderTimer) { clearTimeout(digitRenderTimer); digitRenderTimer = null; }
    if (statePoll) { clearInterval(statePoll); statePoll = null; }
    if (es) { try { es.close(); } catch {} es = null; }
    $('piStage').innerHTML = '';
    count = 0; catchUpRemaining = 0;
    currentRow = null; currentRowStartRank = 1; rowCellCount = 0;
    digitQueue = []; latestDigitEl = null;
    liveCounterCurrent = 0; liveCounterTarget = 0; firstLoadComplete = false;
    updateLiveCounterDOM(0);
    setStatus('idle');
    serverDistribution = new Array(10).fill(0);
    serverTotalDigits = 0;
    renderDist();
    $('rankOut').textContent = 'Entrez un rang pour afficher la décimale correspondante.';
    $('chainOut').textContent = 'Entrez une suite de 2 à 20 chiffres.';
    reconnectDelay = 2000;
    toast('Resynchronisation avec le fichier π…', 'info');
    try { await fetch('/refresh-file', { method: 'POST' }); } catch {}
    connectFileStream();
    updateStorage();
  }

  /* ── Recherches ── */
  let searchAbort = null;
  async function searchRank(value) {
    const rank = parseInt(value, 10);
    if (!rank || rank < 1) { $('rankOut').textContent = 'Entrez un rang pour afficher la décimale correspondante.'; return; }
    if (searchAbort) searchAbort.abort();
    searchAbort = new AbortController();
    try {
      const r = await fetch(`/digit?rank=${rank}`, { signal: searchAbort.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { digit, available } = await r.json();
      if (digit !== null) {
        $('rankOut').innerHTML = `Décimale <strong>n°${fmt(rank)}</strong> = <button type="button" class="bigDigit v${digit}" data-rank="${rank}" title="Cliquer pour localiser">${digit}</button>`;
      } else {
        $('rankOut').textContent = `Décimale n°${fmt(rank)} non encore retranscrite (${fmt(available)} disponibles).`;
      }
    } catch (err) {
      if (err.name !== 'AbortError') $('rankOut').textContent = 'Erreur de recherche.';
    }
  }

  let chainAbort = null;
  async function searchChain(value) {
    const q = value.trim();
    if (!q || q.length < 2 || !/^\d+$/.test(q)) { $('chainOut').textContent = 'Entrez une suite de 2 à 20 chiffres.'; return; }
    if (chainAbort) chainAbort.abort();
    chainAbort = new AbortController();
    try {
      const r = await fetch(`/search-chain?q=${encodeURIComponent(q)}`, { signal: chainAbort.signal });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const { positions, total_checked } = await r.json();
      if (positions.length) {
        const list = positions.slice(0, 5).map((p) => `<button type="button" class="search-pos" data-rank="${p}" title="Cliquer pour localiser">#${fmt(p)}</button>`).join(', ');
        const more = positions.length > 5 ? ` et ${fmt(positions.length - 5)} autres` : '';
        $('chainOut').innerHTML = `Trouvée <strong>${fmt(positions.length)} fois</strong> parmi ${fmt(total_checked)} décimales : ${list}${more}`;
      } else {
        $('chainOut').textContent = `Introuvable dans les ${fmt(total_checked)} décimales vérifiées.`;
      }
    } catch (err) {
      if (err.name !== 'AbortError') $('chainOut').textContent = 'Erreur de recherche.';
    }
  }

  /* ── Actions ── */
  async function share() {
    const url = window.location.origin + '/';
    const title = 'Pi — les décimales de π en temps réel';
    const text = `${fmt(serverTotalDigits)} décimales de π calculées et retranscrites en continu.`;
    try {
      if (navigator.share) { await navigator.share({ title, text, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Lien copié dans le presse-papiers.', 'ok');
    } catch (err) {
      if (err && err.name === 'AbortError') return;
      toast('Partage impossible sur cet appareil.', 'error');
    }
  }

  /* ── Initialisation ── */
  function boot() {
    setupThemeToggle($('themeToggle'));
    $('btnReset').addEventListener('click', hardReset);
    $('btnShare').addEventListener('click', share);
    $('rankSearch').addEventListener('input', (e) => searchRank(e.target.value));
    $('chainSearch').addEventListener('input', (e) => searchChain(e.target.value));
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-rank]');
      if (btn && (btn.classList.contains('bigDigit') || btn.classList.contains('search-pos'))) scrollToRank(parseInt(btn.dataset.rank, 10));
    });

    scheduleRenderDist();
    updateStorage();
    loadSnapshots();
    setStatus('live');
    updateCalculatorStatus();
    connectFileStream();
    setInterval(() => { updateStorage(); loadSnapshots(); }, 15000);
    setInterval(updateCalculatorStatus, 30000);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot, { once: true });
  else boot();
})();
