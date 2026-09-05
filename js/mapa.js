// Visualizador do mapa da cena — página separada das fichas.
// Etapa 3: neblina de guerra. O mestre pinta/revela áreas com um pincel;
// jogadores só veem o que foi revelado. Etapa 2 (tokens) continua igual.

const isMaster = localStorage.getItem('op2_master_ok') === '1';
const FOG_MAX_DIM = 1400;

let charactersCache = [];
let npcsCache = [];
let loadedFogMapId = null; // evita recarregar a própria tela ao salvar a neblina
let fogBrushMode = 'reveal'; // 'reveal' | 'hide'
let fogCellSize = 56; // tamanho da célula da grade, em pixels do canvas (espaço lógico da neblina)
let fogPainting = false;
let fogLastCell = null; // {col,row} da última célula pintada, evita repintar à toa
let fogSaveTimer = null;
let fogPaintingAttached = false;
let fogPixelCanvas = null;   // amostra de pixels da neblina (só jogadores) p/ esconder tokens
let fogPixelMapUrl = null;
let fogNeverPainted = false; // mapa sem neblina salva ainda = tudo escondido

async function render() {
  const { data: session } = await supa.from('session_state').select('active_map_id, map_visible').eq('id', 1).single();

  const canSeeMap = isMaster ? !!session?.active_map_id : (session?.map_visible && session?.active_map_id);
  if (!canSeeMap) { showEmpty(); return; }

  const { data: map } = await supa.from('maps').select('*').eq('id', session.active_map_id).single();
  if (!map) { showEmpty(); return; }

  const img = document.getElementById('mapImage');
  if (img.src !== map.image_url) img.src = map.image_url;
  document.getElementById('mapContent').style.display = 'block';
  document.getElementById('mapEmpty').style.display = 'none';
  document.getElementById('mapModeLabel').textContent = isMaster
    ? 'Ordem Paranormal RPG II — modo mestre (arraste os tokens, pinte a neblina)'
    : (session.map_visible ? 'Ordem Paranormal RPG II' : 'Ordem Paranormal RPG II — pré-visualização do mestre');

  const afterImageReady = async () => {
    await initFogLayer(map);
    await loadCombatants();
    renderTokens();
  };

  if (img.complete && img.naturalWidth) await afterImageReady();
  else img.onload = () => { afterImageReady(); };
}

function showEmpty() {
  document.getElementById('mapContent').style.display = 'none';
  document.getElementById('mapEmpty').style.display = 'block';
}

// ---------------- Neblina de guerra ----------------

async function initFogLayer(map) {
  const canvas = document.getElementById('fogCanvas');
  const overlay = document.getElementById('fogOverlayImg');

  if (!isMaster) {
    overlay.style.display = 'none';
    canvas.style.display = 'block';
    canvas.style.cursor = 'default';
    const ctx = canvas.getContext('2d');
    if (map.fog_url) {
      await updateFogPixelSampler(map.fog_url);
      fogNeverPainted = false;
      if (fogPixelCanvas) {
        canvas.width = fogPixelCanvas.width;
        canvas.height = fogPixelCanvas.height;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(fogPixelCanvas, 0, 0);
      } else {
        canvas.width = 10; canvas.height = 10;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
    } else {
      fogNeverPainted = true;
      fogPixelCanvas = null;
      fogPixelMapUrl = null;
      canvas.width = 10; canvas.height = 10;
      fillFog(ctx, canvas);
    }
    return;
  }

  // Mestre: usa o canvas interativo. Só recarrega do zero quando o mapa
  // ativo muda — recarregar a cada salvamento apagaria traços em andamento.
  overlay.style.display = 'none';
  canvas.style.display = 'block';
  document.getElementById('fogGridOverlay').style.display = 'block';
  document.getElementById('fogToolbar').style.display = 'flex';

  if (loadedFogMapId === map.id) { drawFogGrid(); return; }
  loadedFogMapId = map.id;

  const img = document.getElementById('mapImage');
  const w = img.naturalWidth || 1000, h = img.naturalHeight || 1000;
  const scale = Math.min(1, FOG_MAX_DIM / Math.max(w, h));
  canvas.width = Math.max(1, Math.round(w * scale));
  canvas.height = Math.max(1, Math.round(h * scale));
  const ctx = canvas.getContext('2d');

  await new Promise(resolve => {
    if (!map.fog_url) { fillFog(ctx, canvas); resolve(); return; }
    const fogImg = new Image();
    fogImg.crossOrigin = 'anonymous';
    fogImg.onload = () => { ctx.clearRect(0, 0, canvas.width, canvas.height); ctx.drawImage(fogImg, 0, 0, canvas.width, canvas.height); resolve(); };
    fogImg.onerror = () => { fillFog(ctx, canvas); resolve(); };
    fogImg.src = map.fog_url;
  });

  drawFogGrid();
  if (!fogPaintingAttached) { attachFogPainting(canvas); fogPaintingAttached = true; }
  setupFogToolbar();
}

function fillFog(ctx, canvas) {
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
}

function canvasPointFromEvent(e, canvas) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (e.clientX - rect.left) / rect.width * canvas.width,
    y: (e.clientY - rect.top) / rect.height * canvas.height,
  };
}

function cellAt(p) {
  return { col: Math.floor(p.x / fogCellSize), row: Math.floor(p.y / fogCellSize) };
}

function paintCell(ctx, col, row) {
  const x = col * fogCellSize, y = row * fogCellSize;
  if (fogBrushMode === 'reveal') {
    ctx.clearRect(x, y, fogCellSize, fogCellSize);
  } else {
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = '#000';
    ctx.fillRect(x, y, fogCellSize, fogCellSize);
  }
}

// Pinta todas as células no caminho entre dois pontos, para não pular
// quadrados quando o ponteiro se move rápido durante o arrasto.
function paintCellsAlong(ctx, from, to) {
  const a = cellAt(from), b = cellAt(to);
  const steps = Math.max(Math.abs(b.col - a.col), Math.abs(b.row - a.row), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = Math.round(a.col + (b.col - a.col) * t);
    const row = Math.round(a.row + (b.row - a.row) * t);
    if (fogLastCell && fogLastCell.col === col && fogLastCell.row === row) continue;
    paintCell(ctx, col, row);
    fogLastCell = { col, row };
  }
}

function drawFogGrid() {
  const fogCanvas = document.getElementById('fogCanvas');
  const grid = document.getElementById('fogGridOverlay');
  grid.width = fogCanvas.width;
  grid.height = fogCanvas.height;
  const ctx = grid.getContext('2d');
  ctx.clearRect(0, 0, grid.width, grid.height);
  ctx.strokeStyle = 'rgba(201,163,90,0.35)';
  ctx.lineWidth = 1;
  for (let x = 0; x <= grid.width; x += fogCellSize) {
    ctx.beginPath(); ctx.moveTo(x + 0.5, 0); ctx.lineTo(x + 0.5, grid.height); ctx.stroke();
  }
  for (let y = 0; y <= grid.height; y += fogCellSize) {
    ctx.beginPath(); ctx.moveTo(0, y + 0.5); ctx.lineTo(grid.width, y + 0.5); ctx.stroke();
  }
}

function attachFogPainting(canvas) {
  const ctx = canvas.getContext('2d');

  canvas.addEventListener('pointerdown', e => {
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    fogPainting = true;
    fogLastCell = null;
    const p = canvasPointFromEvent(e, canvas);
    const c = cellAt(p);
    paintCell(ctx, c.col, c.row);
    fogLastCell = c;
    scheduleFogAutoSave();
  });
  canvas.addEventListener('pointermove', e => {
    if (!fogPainting) return;
    const p = canvasPointFromEvent(e, canvas);
    paintCellsAlong(ctx, { x: fogLastCell.col * fogCellSize, y: fogLastCell.row * fogCellSize }, p);
    scheduleFogAutoSave();
  });
  const endStroke = () => {
    if (!fogPainting) return;
    fogPainting = false;
    fogLastCell = null;
    saveFogNow();
  };
  canvas.addEventListener('pointerup', endStroke);
  canvas.addEventListener('pointercancel', endStroke);
}

function scheduleFogAutoSave() {
  if (fogSaveTimer) return;
  fogSaveTimer = setTimeout(() => { fogSaveTimer = null; saveFogNow(); }, 1200);
}

async function saveFogNow() {
  const canvas = document.getElementById('fogCanvas');
  const mapId = loadedFogMapId;
  if (!mapId) return;
  canvas.toBlob(async blob => {
    if (!blob) return;
    const path = `fog-${mapId}.png`;
    const { error: upErr } = await supa.storage.from('maps').upload(path, blob, { upsert: true, contentType: 'image/png' });
    if (upErr) return;
    const { data } = supa.storage.from('maps').getPublicUrl(path);
    await supa.from('maps').update({ fog_url: `${data.publicUrl}?v=${Date.now()}` }).eq('id', mapId);
  }, 'image/png');
}

function setupFogToolbar() {
  const btnReveal = document.getElementById('fogModeReveal');
  const btnHide = document.getElementById('fogModeHide');
  const setMode = mode => {
    fogBrushMode = mode;
    btnReveal.classList.toggle('mode-active', mode === 'reveal');
    btnHide.classList.toggle('mode-active', mode === 'hide');
  };
  btnReveal.onclick = () => setMode('reveal');
  btnHide.onclick = () => setMode('hide');
  setMode('reveal');

  document.getElementById('fogCellSize').oninput = e => {
    fogCellSize = Number(e.target.value);
    drawFogGrid();
  };

  document.getElementById('fogRevealAll').onclick = () => {
    const canvas = document.getElementById('fogCanvas');
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    saveFogNow();
  };
  document.getElementById('fogHideAll').onclick = async () => {
    const ok = await uiConfirmSimple('Esconder o mapa inteiro de novo?');
    if (!ok) return;
    const canvas = document.getElementById('fogCanvas');
    fillFog(canvas.getContext('2d'), canvas);
    saveFogNow();
  };
}

// Confirmação simples, sem depender de ui.js (mapa.html não carrega esse script)
function uiConfirmSimple(msg) { return Promise.resolve(window.confirm(msg)); }

// Amostra os pixels da neblina publicada para saber se um token cai numa
// área ainda escondida (só usado do lado do jogador — o mestre sempre vê tudo).
async function updateFogPixelSampler(fogUrl) {
  if (fogPixelMapUrl === fogUrl) return;
  fogPixelMapUrl = fogUrl;
  await new Promise(resolve => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d').drawImage(img, 0, 0);
      fogPixelCanvas = c;
      resolve();
    };
    img.onerror = () => { fogPixelCanvas = null; resolve(); };
    img.src = fogUrl;
  });
}

function isPointHiddenByFog(xPct, yPct) {
  if (!fogPixelCanvas) return false; // não deu pra checar (ex: CORS) — falha aberta, mostra o token
  try {
    const x = Math.min(fogPixelCanvas.width - 1, Math.max(0, Math.round(xPct / 100 * fogPixelCanvas.width)));
    const y = Math.min(fogPixelCanvas.height - 1, Math.max(0, Math.round(yPct / 100 * fogPixelCanvas.height)));
    const alpha = fogPixelCanvas.getContext('2d').getImageData(x, y, 1, 1).data[3];
    return alpha > 40; // opaco = ainda escondido
  } catch {
    return false;
  }
}

// ---------------- Tokens (etapa 2) ----------------

async function loadCombatants() {
  const { data: chars } = await supa.from('characters').select('*').eq('in_combat', true);
  charactersCache = chars || [];
  const { data: npcs } = await supa.from('npcs').select('*').eq('in_combat', true);
  npcsCache = npcs || [];
}

function combatants() {
  const chars = charactersCache.map(c => ({
    kind: 'char', id: c.slug, name: c.name, x: c.token_x, y: c.token_y, ref: c,
  }));
  const npcs = npcsCache.map(n => ({
    kind: 'npc', id: n.id, name: n.name, x: n.token_x, y: n.token_y, ref: n,
  }));
  return [...chars, ...npcs];
}

function tokenIconHtml(item) {
  if (item.kind === 'char') return renderAvatar(item.ref, { size: 40 });
  return `<div style="font-size:20px">👹</div>`;
}

function renderTokens() {
  const stage = document.getElementById('mapStage');
  stage.querySelectorAll('.map-token').forEach(el => el.remove());

  const list = combatants();
  let placed = list.filter(t => t.x != null && t.y != null);
  const unplaced = list.filter(t => t.x == null || t.y == null);

  if (!isMaster) {
    placed = fogNeverPainted ? [] : placed.filter(item => !isPointHiddenByFog(item.x, item.y));
  }

  placed.forEach(item => {
    const el = document.createElement('div');
    el.className = 'map-token' + (isMaster ? ' editable' : '');
    el.style.left = item.x + '%';
    el.style.top = item.y + '%';
    el.innerHTML = `${tokenIconHtml(item)}<span class="token-label">${escapeHtml(item.name)}</span>`;
    if (isMaster) {
      const rm = document.createElement('div');
      rm.className = 'token-remove';
      rm.textContent = '✕';
      rm.title = 'Tirar do mapa';
      rm.addEventListener('pointerdown', e => e.stopPropagation());
      rm.addEventListener('click', e => { e.stopPropagation(); saveTokenPosition(item, null, null); });
      el.appendChild(rm);
      makeDraggable(el, item);
    }
    stage.appendChild(el);
  });

  const tray = document.getElementById('mapTray');
  if (isMaster && unplaced.length > 0) {
    tray.style.display = 'flex';
    tray.innerHTML = `<div class="tray-label">Clique para colocar no mapa (depois arraste para o lugar certo)</div>` +
      unplaced.map(item => `
        <div class="map-tray-item" data-place="${item.kind}:${item.id}">
          <div class="map-token">${tokenIconHtml(item)}</div>
          <span>${escapeHtml(item.name)}</span>
        </div>
      `).join('');
    tray.querySelectorAll('[data-place]').forEach(el => {
      el.addEventListener('click', () => {
        const [kind, id] = el.dataset.place.split(':');
        const item = list.find(i => i.kind === kind && String(i.id) === id);
        if (item) saveTokenPosition(item, 50, 50);
      });
    });
  } else {
    tray.style.display = 'none';
    tray.innerHTML = '';
  }
}

function makeDraggable(el, item) {
  el.addEventListener('pointerdown', e => {
    e.preventDefault();
    el.setPointerCapture(e.pointerId);
    const stage = document.getElementById('mapStage');

    const onMove = ev => {
      const rect = stage.getBoundingClientRect();
      const px = Math.max(0, Math.min(100, ((ev.clientX - rect.left) / rect.width) * 100));
      const py = Math.max(0, Math.min(100, ((ev.clientY - rect.top) / rect.height) * 100));
      el.style.left = px + '%';
      el.style.top = py + '%';
      el.dataset.pendingX = px;
      el.dataset.pendingY = py;
    };
    const onUp = () => {
      el.removeEventListener('pointermove', onMove);
      el.removeEventListener('pointerup', onUp);
      const x = Number(el.dataset.pendingX);
      const y = Number(el.dataset.pendingY);
      if (!isNaN(x) && !isNaN(y)) saveTokenPosition(item, x, y);
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerup', onUp);
  });
}

async function saveTokenPosition(item, x, y) {
  if (item.kind === 'char') await supa.from('characters').update({ token_x: x, token_y: y }).eq('slug', item.id);
  else await supa.from('npcs').update({ token_x: x, token_y: y }).eq('id', item.id);
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

function subscribeMap() {
  supa.channel('map-viewer')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_state' }, render)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'maps' }, render)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters' }, async () => { await loadCombatants(); renderTokens(); })
    .on('postgres_changes', { event: '*', schema: 'public', table: 'npcs' }, async () => { await loadCombatants(); renderTokens(); })
    .subscribe();
}

render();
subscribeMap();
