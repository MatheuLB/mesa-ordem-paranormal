// Visualizador do mapa da cena — página separada das fichas.
// Etapa 2: tokens dos agentes/NPCs em combate, posicionáveis por arrastar.
// Só o mestre (localStorage.op2_master_ok) pode mover/colocar/remover tokens;
// jogadores veem os tokens em tempo real, sem poder mexer.

const isMaster = localStorage.getItem('op2_master_ok') === '1';

let charactersCache = [];
let npcsCache = [];

async function render() {
  const { data: session } = await supa.from('session_state').select('active_map_id, map_visible').eq('id', 1).single();

  const canSeeMap = isMaster ? !!session?.active_map_id : (session?.map_visible && session?.active_map_id);
  if (!canSeeMap) { showEmpty(); return; }

  const { data: map } = await supa.from('maps').select('*').eq('id', session.active_map_id).single();
  if (!map) { showEmpty(); return; }

  document.getElementById('mapImage').src = map.image_url;
  document.getElementById('mapContent').style.display = 'block';
  document.getElementById('mapEmpty').style.display = 'none';
  document.getElementById('mapModeLabel').textContent = isMaster
    ? 'Ordem Paranormal RPG II — modo mestre (arraste os tokens)'
    : (session.map_visible ? 'Ordem Paranormal RPG II' : 'Ordem Paranormal RPG II — pré-visualização do mestre');

  await loadCombatants();
  renderTokens();
}

function showEmpty() {
  document.getElementById('mapContent').style.display = 'none';
  document.getElementById('mapEmpty').style.display = 'block';
}

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
  const placed = list.filter(t => t.x != null && t.y != null);
  const unplaced = list.filter(t => t.x == null || t.y == null);

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
