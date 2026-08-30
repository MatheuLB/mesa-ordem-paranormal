const ATTR_LABEL = { fisico: 'Físico', mente: 'Mente', emocao: 'Emoção' };
const MASTER_PASSWORD = 'ORDO2'; // palavra de acesso simples, apenas para não abrir o painel por engano

const SKILL_NAMES = ['Acrobacia','Aptidão','Atletismo','Crime','Disciplina','Enganação','Furtividade','Intimidar','Intuição','Luta','Máquinas','Medicina','Ocultismo','Percepção','Persuasão','Pesquisar','Pontaria','Sobrevivência','Tecnologia','Vigor'];

// valores-base de nível 2, usados pelo botão "resetar atributos" (desfaz bônus temporários de cena)
const BASE_ATTRS = {
  victor: { fisico: 8, mente: 6, emocao: 8 },
  kenia:  { fisico: 6, mente: 10, emocao: 6 },
  eloisa: { fisico: 8, mente: 8, emocao: 6 },
  edgar:  { fisico: 10, mente: 6, emocao: 6 },
  alan:   { fisico: 6, mente: 8, emocao: 8 },
};

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// ---------------- Lock screen ----------------

document.getElementById('btnUnlock').addEventListener('click', tryUnlock);
document.getElementById('masterPass').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });

function tryUnlock() {
  const val = document.getElementById('masterPass').value;
  if (val === MASTER_PASSWORD) {
    sessionStorage.setItem('op2_master_ok', '1');
    boot();
  } else {
    document.getElementById('lockError').style.display = 'block';
  }
}

if (sessionStorage.getItem('op2_master_ok') === '1') boot();

function boot() {
  document.getElementById('lockScreen').style.display = 'none';
  document.getElementById('masterApp').style.display = 'block';
  init();
}

// ---------------- Tabs ----------------

function init() {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  loadCharacters();
  subscribeCharacters();
  loadSceneState();
  loadPois();
  loadFullLog();
  subscribeRollLog();
  setupNpcRoller();
  renderCritFailTable();

  document.getElementById('btnSaveScene').addEventListener('click', saveScene);
  document.getElementById('btnSendNotif').addEventListener('click', sendNotification);
  document.getElementById('roundMinus').addEventListener('click', () => bumpRound(-1));
  document.getElementById('roundPlus').addEventListener('click', () => bumpRound(1));
  document.getElementById('masterNotes').addEventListener('blur', saveScene);
  document.getElementById('btnNewPoi').addEventListener('click', createNewPoi);
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'registro') loadFullLog();
}

// ---------------- Agentes ----------------

let charactersCache = [];

async function loadCharacters() {
  const { data } = await supa.from('characters').select('*').order('name');
  charactersCache = data || [];
  renderCharacters();
}

function subscribeCharacters() {
  supa.channel('master-chars')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters' }, payload => {
      const i = charactersCache.findIndex(c => c.id === payload.new.id);
      if (i >= 0) charactersCache[i] = payload.new;
      renderCharacters();
    })
    .subscribe();
}

function renderCharacters() {
  const wrap = document.getElementById('masterCharList');
  wrap.innerHTML = '';
  charactersCache.forEach(c => wrap.appendChild(renderMasterCharRow(c)));
}

function renderMasterCharRow(c) {
  const div = document.createElement('div');
  div.className = `ornate-frame master-char-row theme-${c.theme_color}`;
  div.innerHTML = `
    <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
    <div>
      <h3>${c.name}</h3>
      <div class="occ">${c.profile} · ${c.occupation}${c.claimed_by ? ' · jogado por ' + escapeHtml(c.claimed_by) : ' · livre'}</div>
      <div class="row" style="margin-top:8px">
        <span class="tag mono">Fís d${c.fisico}</span><span class="tag mono">Men d${c.mente}</span><span class="tag mono">Emo d${c.emocao}</span>
      </div>
    </div>
    <div class="stack">
      <div class="row">
        <span class="resource-label">PV</span>
        <div class="stepper">
          <button class="btn-icon" data-act="pv-1">−</button>
          <span class="val">${c.pv_current}/${c.pv_max}</span>
          <button class="btn-icon" data-act="pv+1">+</button>
        </div>
      </div>
      <div class="row">
        <span class="resource-label">PD</span>
        <div class="stepper">
          <button class="btn-icon" data-act="pd-1">−</button>
          <span class="val">${c.pd_current}/${c.pd_max}</span>
          <button class="btn-icon" data-act="pd+1">+</button>
        </div>
      </div>
      ${c.impeto_max ? `<div class="row"><span class="resource-label">ÍMP</span><div class="stepper"><button class="btn-icon" data-act="imp-1">−</button><span class="val">${c.impeto_used}/${c.impeto_max}</span><button class="btn-icon" data-act="imp+1">+</button></div></div>` : ''}
    </div>
    <div class="stack">
      <button class="btn small" data-act="reset-full">Resetar PV/PD/Ímpeto</button>
      <button class="btn small" data-act="reset-attr">Resetar atributos</button>
      ${c.claimed_by ? `<button class="btn small" data-act="unclaim">Liberar personagem</button>` : ''}
    </div>
  `;

  div.querySelectorAll('button[data-act]').forEach(btn => {
    btn.addEventListener('click', () => handleCharAction(c, btn.dataset.act));
  });
  return div;
}

async function handleCharAction(c, act) {
  const updates = {};
  if (act === 'pv-1') updates.pv_current = Math.max(0, c.pv_current - 1);
  if (act === 'pv+1') updates.pv_current = Math.min(c.pv_max, c.pv_current + 1);
  if (act === 'pd-1') updates.pd_current = Math.max(0, c.pd_current - 1);
  if (act === 'pd+1') updates.pd_current = Math.min(c.pd_max, c.pd_current + 1);
  if (act === 'imp-1') updates.impeto_used = Math.max(0, c.impeto_used - 1);
  if (act === 'imp+1') updates.impeto_used = Math.min(c.impeto_max, c.impeto_used + 1);
  if (act === 'reset-full') { updates.pv_current = c.pv_max; updates.pd_current = c.pd_max; updates.impeto_used = 0; updates.avaliacao_dice = 0; }
  if (act === 'reset-attr') Object.assign(updates, BASE_ATTRS[c.slug]);
  if (act === 'unclaim') updates.claimed_by = null;

  await supa.from('characters').update(updates).eq('slug', c.slug);
}

// ---------------- Cena / estado da sessão ----------------

let sceneState = null;

async function loadSceneState() {
  const { data } = await supa.from('session_state').select('*').eq('id', 1).single();
  sceneState = data;
  document.getElementById('sceneTitle').value = data.scene_title || '';
  document.getElementById('sceneDt').value = data.scene_dt || 7;
  document.getElementById('roundVal').textContent = data.round_number || 0;
  document.getElementById('masterNotes').value = data.master_notes || '';
}

async function saveScene() {
  const updates = {
    scene_title: document.getElementById('sceneTitle').value,
    scene_dt: Number(document.getElementById('sceneDt').value) || 7,
    master_notes: document.getElementById('masterNotes').value,
    updated_at: new Date().toISOString(),
  };
  await supa.from('session_state').update(updates).eq('id', 1);
}

async function bumpRound(delta) {
  const el = document.getElementById('roundVal');
  const val = Math.max(0, Number(el.textContent) + delta);
  el.textContent = val;
  await supa.from('session_state').update({ round_number: val }).eq('id', 1);
}

async function sendNotification() {
  const text = document.getElementById('notifInput').value.trim();
  if (!text) return;
  await supa.from('session_state').update({ notification: text, notification_at: new Date().toISOString() }).eq('id', 1);
  document.getElementById('notifInput').value = '';
}

// ---------------- Investigação ----------------

let poisCache = [];

async function loadPois() {
  const { data } = await supa.from('investigation_points').select('*').order('order_index');
  poisCache = data || [];
  renderPoiEditor();
}

function renderPoiEditor() {
  const wrap = document.getElementById('poiEditorList');
  wrap.innerHTML = '';
  if (poisCache.length === 0) {
    wrap.innerHTML = `<div class="empty-state">Nenhum ponto de interesse criado ainda.</div>`;
    return;
  }
  poisCache.forEach(p => wrap.appendChild(renderPoiEditorCard(p)));
}

function renderPoiEditorCard(p) {
  const div = document.createElement('div');
  div.className = 'ornate-frame poi-card';
  const clues = p.clues || [];

  div.innerHTML = `
    <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
    <div class="poi-head">
      <input type="text" class="poi-name" value="${escapeHtml(p.name)}" style="font-family:var(--font-display);font-size:18px;background:transparent;border:none;border-bottom:1px solid var(--border-soft);flex:1">
      <label style="display:flex;align-items:center;gap:6px;margin:0"><input type="checkbox" class="poi-revealed" ${p.revealed ? 'checked' : ''}> Revelado aos jogadores</label>
      <button class="btn small danger poi-delete">Excluir</button>
    </div>
    <div class="stack" style="margin:10px 0">
      <div><label>Descrição básica (o que o mestre narra)</label><textarea class="poi-basic" rows="2" style="width:100%">${escapeHtml(p.description_basic)}</textarea></div>
      <div><label>Descrição contextual (só o mestre vê)</label><textarea class="poi-context" rows="2" style="width:100%">${escapeHtml(p.description_contextual)}</textarea></div>
    </div>
    <div class="stack clue-rows"></div>
    <button class="btn small add-clue">+ Adicionar pista</button>
  `;

  const clueRowsWrap = div.querySelector('.clue-rows');
  clues.forEach((c, idx) => clueRowsWrap.appendChild(renderClueRow(p, c, idx)));

  div.querySelector('.poi-name').addEventListener('change', e => savePoiField(p, 'name', e.target.value));
  div.querySelector('.poi-basic').addEventListener('change', e => savePoiField(p, 'description_basic', e.target.value));
  div.querySelector('.poi-context').addEventListener('change', e => savePoiField(p, 'description_contextual', e.target.value));
  div.querySelector('.poi-revealed').addEventListener('change', e => savePoiField(p, 'revealed', e.target.checked));
  div.querySelector('.poi-delete').addEventListener('click', async () => {
    const ok = await uiConfirm('Excluir ponto de interesse?', `Isso vai apagar "${p.name}" e todas as suas pistas.`);
    if (!ok) return;
    await supa.from('investigation_points').delete().eq('id', p.id);
    loadPois();
  });
  div.querySelector('.add-clue').addEventListener('click', async () => {
    const newClues = [...clues, { skill: 'Percepção', dt: 7, info: '', discovered: false }];
    await supa.from('investigation_points').update({ clues: newClues }).eq('id', p.id);
    loadPois();
  });

  return div;
}

function renderClueRow(p, c, idx) {
  const row = document.createElement('div');
  row.className = 'clue-row' + (c.discovered ? ' found' : '');
  row.innerHTML = `
    <select class="clue-skill">${SKILL_NAMES.map(s => `<option value="${s}" ${s === c.skill ? 'selected' : ''}>${s}</option>`).join('')}</select>
    <input type="number" class="clue-dt mono" value="${c.dt}">
    <input type="text" class="clue-info" value="${escapeHtml(c.info)}" placeholder="Informação revelada...">
    <label style="display:flex;gap:4px;align-items:center;margin:0;font-size:11px"><input type="checkbox" class="clue-found" ${c.discovered ? 'checked' : ''}> achada</label>
    <button class="btn-icon clue-del">✕</button>
  `;

  const commit = async () => {
    const updated = { ...c, skill: row.querySelector('.clue-skill').value, dt: Number(row.querySelector('.clue-dt').value), info: row.querySelector('.clue-info').value, discovered: row.querySelector('.clue-found').checked };
    const fresh = poisCache.find(x => x.id === p.id);
    const newClues = [...fresh.clues];
    newClues[idx] = updated;
    await supa.from('investigation_points').update({ clues: newClues }).eq('id', p.id);
  };

  row.querySelector('.clue-skill').addEventListener('change', commit);
  row.querySelector('.clue-dt').addEventListener('change', commit);
  row.querySelector('.clue-info').addEventListener('change', commit);
  row.querySelector('.clue-found').addEventListener('change', commit);
  row.querySelector('.clue-del').addEventListener('click', async () => {
    const fresh = poisCache.find(x => x.id === p.id);
    const newClues = fresh.clues.filter((_, i) => i !== idx);
    await supa.from('investigation_points').update({ clues: newClues }).eq('id', p.id);
    loadPois();
  });

  return row;
}

async function savePoiField(p, field, value) {
  await supa.from('investigation_points').update({ [field]: value }).eq('id', p.id);
}

async function createNewPoi() {
  const name = await uiPrompt('Nome do ponto de interesse', { placeholder: 'Ex: Quadro na parede' });
  if (!name) return;
  await supa.from('investigation_points').insert({ name, description_basic: '', description_contextual: '', clues: [], order_index: poisCache.length, revealed: false });
  loadPois();
}

// ---------------- Rolagem livre (NPCs) ----------------

function setupNpcRoller() {
  const dieOptions = [4, 6, 8, 10, 12, 20].map(d => `<option value="${d}">d${d}</option>`).join('');
  document.getElementById('npcDie1').innerHTML = dieOptions;
  document.getElementById('npcDie2').innerHTML = dieOptions;
  document.getElementById('npcDie3').innerHTML += [4, 6, 8].map(d => `<option value="${d}">d${d}</option>`).join('');
  document.getElementById('btnNpcRoll').addEventListener('click', npcRoll);
}

function npcRoll() {
  const d1 = Number(document.getElementById('npcDie1').value);
  const d2 = Number(document.getElementById('npcDie2').value);
  const d3 = document.getElementById('npcDie3').value;
  const dt = document.getElementById('npcDt').value === '' ? null : Number(document.getElementById('npcDt').value);
  const dice = [{ sides: d1, label: 'Perícia' }, { sides: d2, label: 'Atributo' }];
  if (d3) dice.push({ sides: Number(d3), label: 'Bônus' });

  const result = performTest(dice, dt);
  const preview = document.getElementById('npcDicePreview');
  preview.innerHTML = '';
  result.rolled.forEach(d => {
    const el = document.createElement('div');
    el.className = 'die-face';
    if (result.dropped.includes(d)) el.classList.add('dropped');
    else if (d.value === result.ra) el.classList.add('high');
    if (d.value === result.rb && result.rb !== result.ra) el.classList.add('low');
    el.innerHTML = `${d.value}<span class="lbl">d${d.sides}</span>`;
    preview.appendChild(el);
  });

  const resDiv = document.getElementById('npcRollResult');
  resDiv.style.display = 'block';
  let verdictHtml = '';
  if (result.criticalSuccess) verdictHtml = `<div class="verdict crit-s">SUCESSO CRÍTICO!</div>`;
  else if (result.criticalFail) verdictHtml = `<div class="verdict crit-f">FALHA CRÍTICA!</div>`;
  else if (result.passed === true) verdictHtml = `<div class="verdict pass">SUCESSO</div>`;
  else if (result.passed === false) verdictHtml = `<div class="verdict fail">FALHA</div>`;
  resDiv.innerHTML = `<div class="total">${result.total}</div><div class="mono" style="font-size:12px;color:var(--text-dim);margin-bottom:6px">RA ${result.ra} · RB ${result.rb}</div>${verdictHtml}`;
}

function renderCritFailTable() {
  const wrap = document.getElementById('critFailTable');
  wrap.innerHTML = CRIT_FAIL_TABLE.map(e => `
    <div class="row" style="border-bottom:1px dashed var(--border-soft);padding:6px 0">
      <span class="badge-dt">${e.roll}</span>
      <div><b>${e.name}</b><br><span style="color:var(--text-dim);font-size:12px">${e.text}</span></div>
    </div>
  `).join('');
}

// ---------------- Registro ----------------

function renderLogEntry(r) {
  const div = document.createElement('div');
  const cls = r.passed === true || r.is_critical_success ? 'pass' : (r.passed === false || r.is_critical_fail ? 'fail' : '');
  div.className = 'roll-log-entry ' + cls;
  if (r.note && !r.skill_name) {
    div.innerHTML = `<span class="who">${escapeHtml(r.character_name || '')}</span> ${escapeHtml(r.note)}`;
  } else {
    div.innerHTML = `<span class="who">${escapeHtml(r.character_name || '')}</span> rolou <b>${escapeHtml(r.skill_name || '')}</b>
      <span class="meta">[${r.skill_result}+${r.attribute_result}=${r.total}${r.dt ? ' vs DT ' + r.dt : ''}]</span>
      ${r.is_critical_success ? ' 🔥 crítico' : ''}${r.is_critical_fail ? ' 💀 falha crítica' : ''}
      ${r.note ? ' — ' + escapeHtml(r.note) : ''}`;
  }
  return div;
}

async function loadFullLog() {
  const { data } = await supa.from('roll_log').select('*').order('created_at', { ascending: false }).limit(150);
  const el = document.getElementById('masterFullLog');
  el.innerHTML = '';
  (data || []).reverse().forEach(r => el.appendChild(renderLogEntry(r)));
  el.scrollTop = el.scrollHeight;
}

function subscribeRollLog() {
  supa.channel('master-roll-log')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'roll_log' }, payload => {
      if (document.getElementById('tab-registro').classList.contains('active')) {
        document.getElementById('masterFullLog').appendChild(renderLogEntry(payload.new));
      }
    })
    .subscribe();
}
