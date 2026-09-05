const ATTR_LABEL = { fisico: 'Físico', mente: 'Mente', emocao: 'Emoção' };
const BONUS_DIE_DEFAULT = 4; // dado bônus genérico (Avaliação/Foco/Ímpeto) = d4

let currentChar = null;
let pendingBonusDice = []; // [{sides,label}]
let selectedSkill = null;  // {name, die, attr}
let charChannel = null;
let sessionState = null;
let notifChannel = null;
let lastSeenNotifId = Number(localStorage.getItem('op2_last_notif_id') || 0);
let helpChannel = null;
let pendingHelpSteps = 0;
let pendingHelpSources = []; // [{id, from}]

// ---------------- Trava leve de personagem (sem conta real) ----------------
// Cada navegador que reivindica um personagem guarda um token local; só quem
// tem o token pode agir por ele. O mestre pode liberar a qualquer momento.

function getClaimTokens() {
  try { return JSON.parse(localStorage.getItem('op2_claim_tokens') || '{}'); } catch { return {}; }
}
function saveClaimToken(slug, token) {
  const t = getClaimTokens();
  t[slug] = token;
  localStorage.setItem('op2_claim_tokens', JSON.stringify(t));
}
function isOwner(c) {
  if (!c.claimed_by) return true;
  return getClaimTokens()[c.slug] === c.claim_token;
}
function newToken() { return Math.random().toString(36).slice(2) + Date.now().toString(36); }
function requireOwner() {
  if (isOwner(currentChar)) return true;
  uiToast('Este personagem está travado por outro jogador — peça ao mestre para liberar.', 'error');
  return false;
}

async function ensurePlayerName() {
  let n = localStorage.getItem('op2_player_name');
  if (!n) {
    n = await uiPrompt('Como podemos te chamar na mesa?', { placeholder: 'Seu nome' });
    n = n || 'Jogador';
    localStorage.setItem('op2_player_name', n);
  }
  return n;
}

function playerName() {
  return localStorage.getItem('op2_player_name') || 'Jogador';
}

async function init() {
  const name = await ensurePlayerName();
  document.getElementById('playerNameTag').style.display = 'inline-block';
  document.getElementById('playerNameTag').textContent = name;

  document.getElementById('btnSwitchChar').addEventListener('click', () => {
    localStorage.removeItem('op2_char_slug');
    showSelectScreen();
  });

  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', () => switchTab(btn.dataset.tab));
  });

  document.getElementById('btnRoll').addEventListener('click', doRoll);
  document.getElementById('btnClearScene').addEventListener('click', clearSceneBonuses);
  document.getElementById('notifClose').addEventListener('click', () => {
    document.getElementById('notifBanner').style.display = 'none';
  });
  document.getElementById('btnContinueNew').addEventListener('click', continueWithNewCharacter);
  document.getElementById('btnRequestHelp').addEventListener('click', requestHelp);
  document.getElementById('btnInvAdd').addEventListener('click', addInventoryItem);
  document.getElementById('btnRollInit').addEventListener('click', rollInitiative);
  document.getElementById('notesInput').addEventListener('change', e => {
    if (!isOwner(currentChar)) return;
    updateCharField('notes', e.target.value);
  });

  await loadSessionState();
  subscribeSession();
  subscribeRollLog();

  const savedSlug = localStorage.getItem('op2_char_slug');
  if (savedSlug) {
    const ok = await selectCharacter(savedSlug);
    if (!ok) showSelectScreen();
  } else {
    showSelectScreen();
  }
}

function switchTab(tab) {
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.toggle('active', p.id === 'tab-' + tab));
  if (tab === 'investigacao') loadInvestigationPoints();
  if (tab === 'registro') loadFullLog();
  if (tab === 'iniciativa') renderInitPreview();
}

// ---------------- Iniciativa ----------------

function renderInitPreview() {
  if (!currentChar) return;
  const preview = document.getElementById('initDicePreview');
  preview.innerHTML = `
    <div class="die-face">? <span class="lbl">d${currentChar.fisico}</span></div>
    <div class="die-face">? <span class="lbl">d${currentChar.emocao}</span></div>
  `;
  document.getElementById('initRollResult').style.display = 'none';
  document.getElementById('btnRollInit').disabled = !isOwner(currentChar);
}

async function rollInitiative() {
  if (!requireOwner()) return;
  const dice = [{ sides: currentChar.fisico, label: 'Físico' }, { sides: currentChar.emocao, label: 'Emoção' }];
  const result = performTest(dice, null);

  const preview = document.getElementById('initDicePreview');
  preview.innerHTML = '';
  result.rolled.forEach(d => {
    const el = document.createElement('div');
    el.className = 'die-face';
    if (d.value === result.ra) el.classList.add('high');
    if (d.value === result.rb && result.rb !== result.ra) el.classList.add('low');
    if (result.criticalSuccess || result.criticalFail) el.classList.add('crit');
    el.innerHTML = `${d.value}<span class="lbl">d${d.sides}</span>`;
    preview.appendChild(el);
  });

  const resDiv = document.getElementById('initRollResult');
  resDiv.style.display = 'block';
  resDiv.innerHTML = `<div class="total">${result.total}</div><div style="font-family:var(--font-mono);font-size:12px;color:var(--text-dim)">RA ${result.ra} · RB ${result.rb}</div>`;

  await updateCharField('initiative', result.total);
  await updateCharField('in_combat', true);
  await supa.from('roll_log').insert({
    character_name: currentChar.name, skill_name: 'Iniciativa', attribute_name: 'Físico + Emoção',
    skill_result: result.rolled[0]?.value, attribute_result: result.rolled[1]?.value, total: result.total,
    rolagem_alta: result.ra, rolagem_baixa: result.rb,
    is_critical_success: result.criticalSuccess, is_critical_fail: result.criticalFail,
  });
}

async function showSelectScreen() {
  document.getElementById('selectScreen').style.display = 'block';
  document.getElementById('sheetScreen').style.display = 'none';
  document.getElementById('btnSwitchChar').style.display = 'none';

  const { data, error } = await supa.from('characters').select('*').order('name');
  if (error) { console.error(error); return; }

  const grid = document.getElementById('charGrid');
  grid.innerHTML = '';
  data.forEach(c => {
    const card = document.createElement('div');
    const frameClass = c.is_generated ? 'badge-frame' : 'ornate-frame';
    card.className = `${frameClass} char-card theme-${c.theme_color}`;
    card.innerHTML = `
      <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
      <div class="portrait-slot">${renderAvatar(c, { size: 40 })}</div>
      ${c.claimed_by ? `<span class="claimed-badge">${escapeHtml(c.claimed_by)}</span>` : ''}
      ${c.is_generated ? `<div class="generated-tag">Agente gerado</div>` : ''}
      <div class="profile-tag">${c.profile} · Nível ${c.level}</div>
      <h3>${c.name}</h3>
      <div class="occ">${c.occupation}</div>
      <div class="bars">
        <div class="resource-row"><span class="resource-label">PV</span><div class="resource-track">${pipStrip(c.pv_current, c.pv_max, 'pv')}</div></div>
        <div class="resource-row"><span class="resource-label">PD</span><div class="resource-track">${pipStrip(c.pd_current, c.pd_max, 'pd')}</div></div>
      </div>
    `;
    card.addEventListener('click', () => selectCharacter(c.slug));
    grid.appendChild(card);
  });
}

function pipStrip(current, max, cls) {
  let html = '';
  for (let i = 0; i < max; i++) html += `<div class="pip ${i < current ? 'filled ' + cls : ''}"></div>`;
  return html;
}

async function selectCharacter(slug) {
  const { data, error } = await supa.from('characters').select('*').eq('slug', slug).single();
  if (error || !data) return false;

  selectedSkill = null;
  pendingBonusDice = [];
  document.getElementById('rollerSkillName').textContent = 'selecione uma perícia';
  document.getElementById('btnRoll').disabled = true;
  document.getElementById('rollResult').style.display = 'none';
  document.getElementById('dicePreview').innerHTML = '';
  document.getElementById('bonusDiceTags').innerHTML = '';
  document.getElementById('initRollResult').style.display = 'none';
  document.getElementById('initDicePreview').innerHTML = '';
  switchTab('ficha');

  const name = playerName();
  if (!data.claimed_by) {
    const token = newToken();
    await supa.from('characters').update({ claimed_by: name, claim_token: token }).eq('slug', slug);
    data.claimed_by = name;
    data.claim_token = token;
    saveClaimToken(slug, token);
  }

  localStorage.setItem('op2_char_slug', slug);
  currentChar = data;
  renderSheet();

  document.getElementById('selectScreen').style.display = 'none';
  document.getElementById('sheetScreen').style.display = 'block';
  document.getElementById('btnSwitchChar').style.display = 'inline-block';

  if (charChannel) supa.removeChannel(charChannel);
  charChannel = supa.channel('char-' + slug)
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters', filter: `slug=eq.${slug}` }, payload => {
      currentChar = payload.new;
      renderSheet();
    })
    .subscribe();

  subscribeNotifications();
  loadInvestigationPoints();
  loadFullLog();

  pendingHelpSteps = 0;
  pendingHelpSources = [];
  renderPendingHelpTag();
  loadTeammatesForHelp();
  subscribeHelpRequests();
  return true;
}

function escapeHtml(s) { const d = document.createElement('div'); d.textContent = s ?? ''; return d.innerHTML; }

// ---------------- Sheet rendering ----------------

function renderSheet() {
  const c = currentChar;
  const header = document.getElementById('sheetHeaderTheme');
  const frameClass = c.is_generated ? 'badge-frame' : 'ornate-frame';
  header.className = `${frameClass} sheet-header theme-${c.theme_color}`;

  document.getElementById('portraitSlot').innerHTML = renderAvatar(c, { size: 64 });

  document.getElementById('chName').textContent = c.name;
  document.getElementById('chProfile').textContent = c.profile;
  document.getElementById('chOcc').textContent = c.occupation;
  document.getElementById('chLevel').textContent = 'Nível ' + c.level;

  const readOnlyNote = document.getElementById('readonlyNote');
  if (!isOwner(c)) {
    readOnlyNote.style.display = 'block';
    readOnlyNote.textContent = `Ficha de ${c.claimed_by} — protegida, você só pode visualizar. Peça ao mestre para liberar o personagem se precisar assumi-lo.`;
  } else {
    readOnlyNote.style.display = 'none';
  }

  renderAdventureBanner();
  renderResource('pv', c.pv_current, c.pv_max);
  renderResource('pd', c.pd_current, c.pd_max);
  renderInventory();
  document.getElementById('notesInput').value = c.notes || '';
  document.getElementById('notesInput').disabled = !isOwner(c);

  const attrList = document.getElementById('attrList');
  attrList.innerHTML = '';
  ['fisico', 'mente', 'emocao'].forEach(a => {
    const row = document.createElement('div');
    row.className = 'attr-row';
    row.innerHTML = `<span class="attr-name">${ATTR_LABEL[a]}</span><span class="die-badge"><span>d${c[a]}</span></span>`;
    attrList.appendChild(row);
  });

  const abilityList = document.getElementById('abilityList');
  abilityList.innerHTML = '';
  (c.abilities || []).forEach(ab => abilityList.appendChild(renderAbilityCard(ab)));
  renderProfileWidgets(abilityList);

  const skillList = document.getElementById('skillList');
  skillList.innerHTML = '';
  (c.skills || []).forEach(s => {
    const row = document.createElement('div');
    row.className = 'skill-row';
    row.innerHTML = `
      <div><div class="sname">${s.name}</div><div class="sattr">${ATTR_LABEL[s.attr]}</div></div>
      <div class="dpair"><span class="d">d${s.die}</span>+<span class="d">d${c[s.attr]}</span></div>
      <div class="mono" style="color:var(--text-faint);font-size:11px">DT7</div>
      <button class="btn small" data-skill='${JSON.stringify(s)}'>Rolar</button>
    `;
    row.querySelector('button').addEventListener('click', () => pickSkill(s));
    skillList.appendChild(row);
  });

  document.getElementById('btnRoll').disabled = !selectedSkill || !isOwner(c);

  // Nota: NÃO chamar updateDicePreview() aqui — renderSheet() roda a cada
  // atualização (inclusive logo após doRoll gravar o resultado real dos dados
  // no PV/PD, como o auto-preenchimento de Ímpeto), e isso apagaria os valores
  // rolados. O preview só é redesenhado explicitamente por pickSkill/addBonusDie.
}

function renderResource(kind, current, max) {
  document.getElementById(kind + 'Track').innerHTML = pipStrip(current, max, kind);
  document.getElementById(kind + 'Num').textContent = `${current}/${max}`;
  document.querySelectorAll(`#${kind}Track .pip`).forEach((pip, i) => {
    pip.style.cursor = 'pointer';
    pip.addEventListener('click', () => {
      const newVal = (i + 1 === current) ? i : i + 1;
      updateCharField(kind + '_current', newVal);
    });
  });
}

function renderAbilityCard(ab) {
  const div = document.createElement('div');
  div.className = 'ability-card';
  div.innerHTML = `<div class="src">${ab.source}</div><h4>${ab.title}</h4><p>${ab.text}</p>`;
  return div;
}

function renderProfileWidgets(container) {
  const c = currentChar;

  if (c.profile === 'Executor') {
    const div = document.createElement('div');
    div.className = 'ability-card';
    let slots = '';
    for (let i = 0; i < c.impeto_max; i++) {
      slots += `<div class="impeto-slot ${i < c.impeto_used ? 'filled' : ''}" data-i="${i}"></div>`;
    }
    div.innerHTML = `
      <div class="src">Barra de Ímpeto</div>
      <h4>${c.impeto_used}/${c.impeto_max} preenchidos</h4>
      <div class="impeto-track">${slots}</div>
      <div class="row" style="margin-top:10px">
        <button class="btn small" id="btnSpendImpeto1" ${c.impeto_used < 1 ? 'disabled' : ''}>Gastar 1: +1d${BONUS_DIE_DEFAULT} no teste</button>
        <button class="btn small" id="btnSpendImpeto3" ${c.impeto_used < 3 ? 'disabled' : ''}>Gastar 3: +1 passo em um atributo</button>
      </div>
    `;
    container.appendChild(div);
    div.querySelectorAll('.impeto-slot').forEach(el => el.addEventListener('click', () => {
      const i = Number(el.dataset.i);
      const newVal = (i + 1 === c.impeto_used) ? i : i + 1;
      updateCharField('impeto_used', newVal);
    }));
    div.querySelector('#btnSpendImpeto1').addEventListener('click', async () => {
      if (!requireOwner() || currentChar.impeto_used < 1) return;
      await updateCharField('impeto_used', currentChar.impeto_used - 1);
      addBonusDie(BONUS_DIE_DEFAULT, 'Ímpeto');
    });
    div.querySelector('#btnSpendImpeto3').addEventListener('click', async () => {
      if (!requireOwner() || currentChar.impeto_used < 3) return;
      const attr = await uiChoice('Aumentar qual atributo em 1 passo até o fim da cena?', [
        { label: `Físico (d${currentChar.fisico} → d${stepDie(currentChar.fisico, 1)})`, value: 'fisico' },
        { label: `Mente (d${currentChar.mente} → d${stepDie(currentChar.mente, 1)})`, value: 'mente' },
        { label: `Emoção (d${currentChar.emocao} → d${stepDie(currentChar.emocao, 1)})`, value: 'emocao' },
      ]);
      if (!attr) return;
      await updateCharField('impeto_used', currentChar.impeto_used - 3);
      await updateCharField(attr, stepDie(currentChar[attr], 1));
      if (selectedSkill) updateDicePreview();
      logAction(`gastou Ímpeto para aumentar ${ATTR_LABEL[attr]} em 1 passo até o fim da cena.`);
    });
  }

  if (c.abilities.some(a => a.title === 'Avaliação')) {
    const div = document.createElement('div');
    div.className = 'ability-card';
    div.innerHTML = `
      <div class="src">Uso da habilidade</div>
      <h4>Banco de Avaliação (${c.avaliacao_dice}/2)</h4>
      <div class="row">
        <button class="btn small" id="btnAvaliar" ${c.pd_current < 2 || c.avaliacao_dice >= 2 ? 'disabled' : ''}>Avaliar (Ação + 2 PD)</button>
        <button class="btn small" id="btnUsarAval1" ${c.avaliacao_dice < 1 ? 'disabled' : ''}>Usar 1 dado no teste</button>
        <button class="btn small" id="btnUsarAval2" ${c.avaliacao_dice < 2 ? 'disabled' : ''}>Usar 2 dados no teste</button>
      </div>
    `;
    container.appendChild(div);
    div.querySelector('#btnAvaliar').addEventListener('click', async () => {
      if (!requireOwner()) return;
      await updateCharField('pd_current', Math.max(0, currentChar.pd_current - 2));
      await updateCharField('avaliacao_dice', Math.min(2, currentChar.avaliacao_dice + 1));
      logAction('gastou uma ação e 2 PD para Avaliar.');
    });
    div.querySelector('#btnUsarAval1').addEventListener('click', async () => {
      if (!requireOwner()) return;
      await updateCharField('avaliacao_dice', currentChar.avaliacao_dice - 1);
      addBonusDie(BONUS_DIE_DEFAULT, 'Avaliação');
    });
    div.querySelector('#btnUsarAval2').addEventListener('click', async () => {
      if (!requireOwner()) return;
      await updateCharField('avaliacao_dice', currentChar.avaliacao_dice - 2);
      addBonusDie(BONUS_DIE_DEFAULT, 'Avaliação');
      addBonusDie(BONUS_DIE_DEFAULT, 'Avaliação');
    });
  }

  const focoAbility = c.abilities.find(a => a.title === 'Foco Mental' || a.title === 'Foco Emocional' || a.title === 'Foco Físico');
  if (focoAbility) {
    const div = document.createElement('div');
    div.className = 'ability-card';
    const kind = focoAbility.title.replace('Foco ', '').toLowerCase();
    div.innerHTML = `
      <div class="src">Uso da habilidade</div>
      <h4>${focoAbility.title}</h4>
      <button class="btn small" id="btnFoco" ${c.pd_current < 2 ? 'disabled' : ''}>Gastar 2 PD: +1d${BONUS_DIE_DEFAULT} no teste ${kind}</button>
    `;
    container.appendChild(div);
    div.querySelector('#btnFoco').addEventListener('click', async () => {
      if (!requireOwner()) return;
      await updateCharField('pd_current', Math.max(0, currentChar.pd_current - 2));
      addBonusDie(BONUS_DIE_DEFAULT, focoAbility.title);
    });
  }

  if (c.abilities.some(a => a.title === 'Prontidão')) {
    const div = document.createElement('div');
    div.className = 'ability-card';
    div.innerHTML = `<div class="src">Uso da habilidade</div><h4>Prontidão</h4>
      <button class="btn small" id="btnPront" ${c.pd_current < 3 ? 'disabled' : ''}>Gastar 3 PD: agir antes de todos</button>`;
    container.appendChild(div);
    div.querySelector('#btnPront').addEventListener('click', async () => {
      if (!requireOwner()) return;
      await updateCharField('pd_current', Math.max(0, currentChar.pd_current - 3));
      logAction('gastou 3 PD em Prontidão e age antes de todos nesta rodada!');
    });
  }
}

async function updateCharField(field, value) {
  if (!isOwner(currentChar)) return false;
  currentChar[field] = value;
  renderSheet();
  await supa.from('characters').update({ [field]: value, updated_at: new Date().toISOString() }).eq('slug', currentChar.slug);
  return true;
}

// ---------------- Dice roller ----------------

function pickSkill(s) {
  selectedSkill = s;
  document.getElementById('rollerSkillName').textContent = `${s.name} (${ATTR_LABEL[s.attr]})`;
  document.getElementById('btnRoll').disabled = !isOwner(currentChar);
  updateDicePreview();
}

function addBonusDie(sides, label) {
  pendingBonusDice.push({ sides, label });
  updateDicePreview();
}

function renderBonusTags() {
  const wrap = document.getElementById('bonusDiceTags');
  wrap.innerHTML = pendingBonusDice.map((d, i) =>
    `<span class="tag" style="cursor:pointer" title="Clique para remover">+d${d.sides} ${d.label} ✕</span>`
  ).join('');
  Array.from(wrap.children).forEach((el, i) => el.addEventListener('click', () => {
    pendingBonusDice.splice(i, 1);
    updateDicePreview();
  }));
}

// Redesenha os dados como "?" (antes de rolar). Não chamar depois de doRoll(),
// senão apaga o resultado que acabou de ser exibido.
function updateDicePreview() {
  renderBonusTags();

  const preview = document.getElementById('dicePreview');
  preview.innerHTML = '';
  if (!selectedSkill) return;
  const dice = getDiceForRoll();
  dice.forEach(d => {
    const el = document.createElement('div');
    el.className = 'die-face';
    el.innerHTML = `? <span class="lbl">d${d.sides}</span>`;
    preview.appendChild(el);
  });
}

function getDiceForRoll() {
  const skillDie = pendingHelpSteps > 0 ? stepDie(selectedSkill.die, pendingHelpSteps) : selectedSkill.die;
  const skillLabel = selectedSkill.name + (pendingHelpSteps > 0 ? ` (+${pendingHelpSteps} ajuda)` : '');
  const dice = [{ sides: skillDie, label: skillLabel }, { sides: currentChar[selectedSkill.attr], label: ATTR_LABEL[selectedSkill.attr] }];
  return [...dice, ...pendingBonusDice].slice(0, 4);
}

async function doRoll() {
  if (!selectedSkill || !requireOwner()) return;
  const dt = document.getElementById('dtInput').value === '' ? null : Number(document.getElementById('dtInput').value);
  const dice = getDiceForRoll();
  const result = performTest(dice, dt);

  const preview = document.getElementById('dicePreview');
  preview.innerHTML = '';
  result.rolled.forEach(d => {
    const el = document.createElement('div');
    el.className = 'die-face';
    if (result.dropped.includes(d)) el.classList.add('dropped');
    else if (d.value === result.ra) el.classList.add('high');
    if (d.value === result.rb && result.rb !== result.ra) el.classList.add('low');
    if (result.criticalSuccess || result.criticalFail) el.classList.add('crit');
    el.innerHTML = `${d.value}<span class="lbl">d${d.sides}</span>`;
    preview.appendChild(el);
  });

  const resDiv = document.getElementById('rollResult');
  resDiv.style.display = 'block';
  let verdictHtml = '';
  if (result.criticalSuccess) verdictHtml = `<div class="verdict crit-s">SUCESSO CRÍTICO!</div>`;
  else if (result.criticalFail) {
    const cf = rollCritFailTable();
    verdictHtml = `<div class="verdict crit-f">FALHA CRÍTICA! — ${cf.name}${cf.text ? ': ' + cf.text : ''}</div>`;
  } else if (result.passed === true) verdictHtml = `<div class="verdict pass">SUCESSO (DT ${result.dt})</div>`;
  else if (result.passed === false) verdictHtml = `<div class="verdict fail">FALHA (DT ${result.dt})</div>`;

  resDiv.innerHTML = `
    <div class="total">${result.total}</div>
    <div style="font-family:var(--font-mono);font-size:12px;color:var(--text-dim);margin-bottom:6px">RA ${result.ra} · RB ${result.rb}</div>
    ${verdictHtml}
  `;

  // Ímpeto automático em falha (Executor)
  if (result.passed === false && currentChar.profile === 'Executor' && currentChar.impeto_used < currentChar.impeto_max) {
    await updateCharField('impeto_used', currentChar.impeto_used + 1);
  }

  const helpNote = pendingHelpSteps > 0 ? `com ajuda de ${pendingHelpSources.map(s => s.from).join(' e ')} (+${pendingHelpSteps} passo${pendingHelpSteps > 1 ? 's' : ''})` : '';

  await supa.from('roll_log').insert({
    character_name: currentChar.name,
    skill_name: selectedSkill.name,
    attribute_name: ATTR_LABEL[selectedSkill.attr],
    skill_die: dice[0].sides,
    attribute_die: currentChar[selectedSkill.attr],
    skill_result: result.rolled[0]?.value,
    attribute_result: result.rolled[1]?.value,
    total: result.total,
    rolagem_alta: result.ra,
    rolagem_baixa: result.rb,
    is_critical_success: result.criticalSuccess,
    is_critical_fail: result.criticalFail,
    dt: result.dt,
    passed: result.passed,
    note: helpNote,
  });

  if (pendingHelpSteps > 0) {
    const ids = pendingHelpSources.map(s => s.id);
    await Promise.all(ids.map(id => supa.from('help_requests').update({ status: 'used' }).eq('id', id)));
    pendingHelpSteps = 0;
    pendingHelpSources = [];
    renderPendingHelpTag();
  }

  pendingBonusDice = [];
  renderBonusTags();
}

async function logAction(text) {
  await supa.from('roll_log').insert({ character_name: currentChar.name, skill_name: null, note: text });
}

function clearSceneBonuses() {
  pendingBonusDice = [];
  updateDicePreview();
}

// ---------------- Roll log ----------------

function renderLogEntry(r) {
  const div = document.createElement('div');
  const cls = r.passed === true || r.is_critical_success ? 'pass' : (r.passed === false || r.is_critical_fail ? 'fail' : '');
  div.className = 'roll-log-entry ' + cls;
  div.dataset.id = r.id;
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
  const { data } = await supa.from('roll_log').select('*').order('created_at', { ascending: false }).limit(100);
  const el = document.getElementById('fullLog');
  el.innerHTML = '';
  (data || []).reverse().forEach(r => el.appendChild(renderLogEntry(r)));
  el.scrollTop = el.scrollHeight;
}

function subscribeRollLog() {
  supa.channel('roll-log-feed')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'roll_log' }, payload => {
      document.getElementById('miniLog').appendChild(renderLogEntry(payload.new));
      if (document.getElementById('tab-registro').classList.contains('active')) {
        document.getElementById('fullLog').appendChild(renderLogEntry(payload.new));
      }
    })
    .on('postgres_changes', { event: 'DELETE', schema: 'public', table: 'roll_log' }, payload => {
      const id = payload.old?.id;
      if (id === undefined) return;
      document.querySelectorAll(`.roll-log-entry[data-id="${id}"]`).forEach(el => el.remove());
    })
    .subscribe();
  supa.from('roll_log').select('*').order('created_at', { ascending: false }).limit(15).then(({ data }) => {
    const el = document.getElementById('miniLog');
    el.innerHTML = '';
    (data || []).reverse().forEach(r => el.appendChild(renderLogEntry(r)));
  });
}

// ---------------- Session state (broadcasts from mestre) ----------------

async function loadSessionState() {
  const { data } = await supa.from('session_state').select('*').eq('id', 1).single();
  sessionState = data;
  applySessionState();
}

function applySessionState() {
  if (!sessionState) return;
  document.getElementById('dtInput').value = sessionState.scene_dt || 7;
  document.getElementById('mapBanner').style.display = (sessionState.map_visible && sessionState.active_map_id) ? 'flex' : 'none';
}

function subscribeSession() {
  supa.channel('session-feed')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_state' }, payload => {
      sessionState = payload.new;
      applySessionState();
      renderAdventureBanner();
    })
    .subscribe();
}

// ---------------- Ciclo da aventura (início/fim controlados pelo mestre) ----------------

function renderAdventureBanner() {
  const banner = document.getElementById('adventureBanner');
  const text = document.getElementById('adventureText');
  const btnContinue = document.getElementById('btnContinueNew');
  if (!sessionState || !currentChar) { banner.style.display = 'none'; return; }

  const status = sessionState.status || 'aguardando';
  if (status === 'aguardando') { banner.style.display = 'none'; return; }

  banner.className = 'adventure-banner status-' + status;
  banner.style.display = 'flex';
  if (status === 'em_andamento') {
    text.textContent = `Aventura em andamento${sessionState.scene_title ? ' — ' + sessionState.scene_title : ''}`;
    btnContinue.style.display = 'none';
  } else if (status === 'finalizada') {
    text.textContent = 'Esta aventura foi finalizada pelo mestre.';
    btnContinue.style.display = isOwner(currentChar) ? 'inline-block' : 'none';
  }
}

async function continueWithNewCharacter() {
  if (!requireOwner()) return;
  const ok = await uiConfirm('Gerar novo agente?', `"${currentChar.name}" fica salvo na mesa, mas deixa de ser seu. Você assume um novo agente gerado aleatoriamente.`);
  if (!ok) return;

  await supa.from('characters').update({ claimed_by: null, claim_token: null }).eq('slug', currentChar.slug);

  const gen = generateRandomCharacter();
  const token = newToken();
  gen.claimed_by = playerName();
  gen.claim_token = token;

  const { data, error } = await supa.from('characters').insert(gen).select().single();
  if (error) { uiToast('Erro ao gerar personagem: ' + error.message, 'error'); return; }

  saveClaimToken(gen.slug, token);
  localStorage.setItem('op2_char_slug', gen.slug);
  currentChar = data;
  selectedSkill = null;
  pendingBonusDice = [];
  renderSheet();
  switchTab('ficha');
  uiToast(`Novo agente pronto: ${data.name} — ${data.profile} (${data.occupation})`, 'success');
}

// ---------------- Inventário ----------------

function renderInventory() {
  const wrap = document.getElementById('invList');
  const items = currentChar.inventory || [];
  wrap.innerHTML = items.length === 0
    ? `<div class="empty-state" style="padding:14px 0">Nenhum item no inventário.</div>`
    : items.map((it, i) => `
      <div class="inv-row">
        <span>${escapeHtml(it.name)}</span>
        <span class="mono">x${it.qty ?? 1}</span>
        <span style="color:var(--text-dim)">${escapeHtml(it.desc || '')}</span>
        <button class="btn-icon" data-i="${i}" title="Remover">✕</button>
      </div>
    `).join('');
  wrap.querySelectorAll('button[data-i]').forEach(btn => {
    btn.addEventListener('click', () => removeInventoryItem(Number(btn.dataset.i)));
  });
  document.getElementById('btnInvAdd').disabled = !isOwner(currentChar);
}

async function addInventoryItem() {
  if (!requireOwner()) return;
  const nameEl = document.getElementById('invNewName');
  const name = nameEl.value.trim();
  if (!name) return;
  const qty = Number(document.getElementById('invNewQty').value) || 1;
  const desc = document.getElementById('invNewDesc').value.trim();
  const items = [...(currentChar.inventory || []), { name, qty, desc }];
  await updateCharField('inventory', items);
  nameEl.value = '';
  document.getElementById('invNewQty').value = '1';
  document.getElementById('invNewDesc').value = '';
}

async function removeInventoryItem(i) {
  if (!requireOwner()) return;
  const items = (currentChar.inventory || []).filter((_, idx) => idx !== i);
  await updateCharField('inventory', items);
}

// ---------------- Notificações privadas ----------------

function showNotifBanner(n) {
  const label = n.action ? n.text : (n.target_slug ? `[Privado] ${n.text}` : n.text);
  document.getElementById('notifText').textContent = label;
  const actionBtn = document.getElementById('notifAction');
  if (n.action === 'roll_initiative') {
    actionBtn.style.display = 'inline-block';
    actionBtn.textContent = 'Rolar iniciativa';
    actionBtn.onclick = () => {
      switchTab('iniciativa');
      document.getElementById('notifBanner').style.display = 'none';
    };
  } else {
    actionBtn.style.display = 'none';
    actionBtn.onclick = null;
  }
  document.getElementById('notifBanner').style.display = 'flex';
}

async function subscribeNotifications() {
  if (notifChannel) supa.removeChannel(notifChannel);
  const slug = currentChar.slug;

  notifChannel = supa.channel('notif-' + slug)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'notifications' }, payload => {
      const n = payload.new;
      lastSeenNotifId = Math.max(lastSeenNotifId, n.id);
      localStorage.setItem('op2_last_notif_id', String(lastSeenNotifId));
      if (n.target_slug === null || n.target_slug === slug) showNotifBanner(n);
    })
    .subscribe();

  const { data } = await supa.from('notifications').select('*').gt('id', lastSeenNotifId).order('id', { ascending: true });
  if (data && data.length) {
    lastSeenNotifId = data[data.length - 1].id;
    localStorage.setItem('op2_last_notif_id', String(lastSeenNotifId));
    const relevant = [...data].reverse().find(n => n.target_slug === null || n.target_slug === slug);
    if (relevant) showNotifBanner(relevant);
  }
}

// ---------------- Ajuda entre jogadores ----------------
// Regra "Ajuda" (pág. 19): gasta uma ação e uma perícia coerente com d6+.
// Se a perícia de quem ajuda for d6/d8, dá +1 passo no teste; d10/d12, +2 passos.

let teammatesChannel = null;

async function loadTeammatesForHelp() {
  const { data } = await supa.from('characters').select('slug,name,claimed_by').not('claimed_by', 'is', null);
  const sel = document.getElementById('helpTargetSelect');
  const current = sel.value;
  const others = (data || []).filter(c => c.slug !== currentChar.slug);
  sel.innerHTML = others.length === 0
    ? `<option value="">Nenhum outro jogador na mesa ainda</option>`
    : others.map(c => `<option value="${c.slug}">${escapeHtml(c.name)} (${escapeHtml(c.claimed_by)})</option>`).join('');
  if ([...sel.options].some(o => o.value === current)) sel.value = current;
  document.getElementById('btnRequestHelp').disabled = others.length === 0;

  if (!teammatesChannel) {
    teammatesChannel = supa.channel('teammates-feed')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'characters' }, () => loadTeammatesForHelp())
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'characters' }, () => loadTeammatesForHelp())
      .subscribe();
  }
}

async function requestHelp() {
  if (!requireOwner()) return;
  const helperSlug = document.getElementById('helpTargetSelect').value;
  if (!helperSlug) return;
  const { data: helper } = await supa.from('characters').select('name').eq('slug', helperSlug).single();
  if (!helper) return;

  await supa.from('help_requests').insert({
    requester_slug: currentChar.slug, requester_name: currentChar.name,
    helper_slug: helperSlug, helper_name: helper.name,
    context: selectedSkill ? selectedSkill.name : '',
  });
  uiToast(`Pedido de ajuda enviado a ${helper.name}.`, 'success');
}

function subscribeHelpRequests() {
  if (helpChannel) supa.removeChannel(helpChannel);
  const slug = currentChar.slug;
  helpChannel = supa.channel('help-' + slug)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'help_requests' }, () => refreshHelpState())
    .subscribe();
  refreshHelpState();
}

async function refreshHelpState() {
  const slug = currentChar.slug;
  const { data: incoming } = await supa.from('help_requests').select('*').eq('helper_slug', slug).eq('status', 'pending').order('created_at');
  renderHelpIncoming(incoming || []);

  const { data: accepted } = await supa.from('help_requests').select('*').eq('requester_slug', slug).eq('status', 'accepted');
  pendingHelpSteps = (accepted || []).reduce((sum, r) => sum + (r.steps || 0), 0);
  pendingHelpSources = (accepted || []).map(r => ({ id: r.id, from: r.helper_name }));
  renderPendingHelpTag();
}

function renderHelpIncoming(requests) {
  const wrap = document.getElementById('helpIncoming');
  wrap.innerHTML = requests.map(r => `
    <div class="ability-card" data-req="${r.id}">
      <div class="src">Pedido de ${escapeHtml(r.requester_name)}${r.context ? ' — teste de ' + escapeHtml(r.context) : ''}</div>
      <div class="row" style="margin-top:6px">
        <select class="help-skill-select" style="flex:1">
          ${(currentChar.skills || []).filter(s => s.die >= 6).map(s => `<option value="${s.name}" data-die="${s.die}">${s.name} (d${s.die})</option>`).join('') || '<option value="">Nenhuma perícia d6+</option>'}
        </select>
        <button class="btn small primary" data-accept="${r.id}">Ajudar</button>
        <button class="btn small danger" data-decline="${r.id}">Recusar</button>
      </div>
    </div>
  `).join('');

  wrap.querySelectorAll('button[data-accept]').forEach(btn => {
    btn.addEventListener('click', () => {
      const card = btn.closest('[data-req]');
      const sel = card.querySelector('.help-skill-select');
      const opt = sel.selectedOptions[0];
      if (!opt || !opt.value) { uiToast('Você não tem nenhuma perícia d6+ para ajudar.', 'error'); return; }
      respondHelp(Number(btn.dataset.accept), true, opt.value, Number(opt.dataset.die));
    });
  });
  wrap.querySelectorAll('button[data-decline]').forEach(btn => {
    btn.addEventListener('click', () => respondHelp(Number(btn.dataset.decline), false));
  });
}

async function respondHelp(id, accept, skillName, skillDie) {
  if (!accept) {
    await supa.from('help_requests').update({ status: 'declined' }).eq('id', id);
    return;
  }
  const steps = skillDie >= 10 ? 2 : 1;
  await supa.from('help_requests').update({
    status: 'accepted', helper_skill_name: skillName, helper_skill_die: skillDie, steps,
  }).eq('id', id);
  await logAction(`ajudou com ${skillName} (d${skillDie}): +${steps} passo${steps > 1 ? 's' : ''} para quem pediu.`);
  uiToast('Ajuda enviada!', 'success');
}

function renderPendingHelpTag() {
  const wrap = document.getElementById('helpPendingTag');
  if (pendingHelpSteps <= 0) { wrap.innerHTML = ''; return; }
  wrap.innerHTML = `<span class="tag" style="border-color:var(--ok);color:var(--ok)">+${pendingHelpSteps} passo${pendingHelpSteps > 1 ? 's' : ''} na perícia (ajuda de ${pendingHelpSources.map(s => s.from).join(', ')})</span>`;
  if (selectedSkill) updateDicePreview();
}

// ---------------- Investigation points ----------------

async function loadInvestigationPoints() {
  const { data } = await supa.from('investigation_points').select('*').eq('revealed', true).order('order_index');
  const wrap = document.getElementById('poiList');
  wrap.innerHTML = '';
  if (!data || data.length === 0) {
    wrap.innerHTML = `<div class="empty-state">O mestre ainda não revelou pontos de interesse para investigar.</div>`;
    return;
  }
  data.forEach(p => wrap.appendChild(renderPoiCard(p)));
}

function renderPoiCard(p) {
  const div = document.createElement('div');
  div.className = 'ornate-frame poi-card';
  const clues = p.clues || [];
  const skillNames = [...new Set(clues.map(c => c.skill))];
  const discovered = clues.filter(c => c.discovered);

  div.innerHTML = `
    <span class="corner tl"></span><span class="corner tr"></span><span class="corner bl"></span><span class="corner br"></span>
    <div class="poi-head"><h3>${escapeHtml(p.name)}</h3></div>
    <p style="color:var(--text-dim);font-size:13.5px;line-height:1.6">${escapeHtml(p.description_basic)}</p>
    <div style="margin:10px 0" class="row">
      ${skillNames.map(sn => `<button class="btn small" data-skill="${escapeHtml(sn)}">Investigar (${escapeHtml(sn)})</button>`).join('')}
    </div>
    <div class="stack" id="clues-${p.id}">
      ${discovered.map(c => `<div class="clue-row found"><span>${escapeHtml(c.skill)}</span><span class="badge-dt">DT ${c.dt}</span><span>${escapeHtml(c.info)}</span><span></span><span></span></div>`).join('')}
    </div>
  `;

  div.querySelectorAll('button[data-skill]').forEach(btn => {
    btn.addEventListener('click', () => investigatePoi(p, btn.dataset.skill));
  });
  return div;
}

async function investigatePoi(point, skillName) {
  if (!requireOwner()) return;
  const mySkill = (currentChar.skills || []).find(s => s.name === skillName || s.name.startsWith(skillName));
  if (!mySkill) { uiToast(`Seu personagem não tem a perícia "${skillName}" listada — role manualmente na aba Ficha.`, 'error'); return; }

  const dice = [{ sides: mySkill.die, label: mySkill.name }, { sides: currentChar[mySkill.attr], label: ATTR_LABEL[mySkill.attr] }, ...pendingBonusDice].slice(0, 4);
  const result = performTest(dice, null);
  pendingBonusDice = [];

  const { data: fresh } = await supa.from('investigation_points').select('*').eq('id', point.id).single();
  const clues = fresh.clues || [];
  let gotSomething = false;
  clues.forEach(c => {
    if (c.skill === skillName && !c.discovered && result.total >= c.dt) {
      c.discovered = true;
      gotSomething = true;
    }
  });

  await supa.from('investigation_points').update({ clues }).eq('id', point.id);
  await supa.from('roll_log').insert({
    character_name: currentChar.name, skill_name: mySkill.name, attribute_name: ATTR_LABEL[mySkill.attr],
    skill_result: result.rolled[0]?.value, attribute_result: result.rolled[1]?.value, total: result.total,
    rolagem_alta: result.ra, rolagem_baixa: result.rb, is_critical_success: result.criticalSuccess, is_critical_fail: result.criticalFail,
    note: `investigou "${point.name}"`,
  });

  if (!gotSomething) {
    await updateCharField('pd_current', Math.max(0, currentChar.pd_current - 1));
    uiToast(`Rolagem: ${result.total}. Nenhuma informação nova (você perde 1 PD pela busca infrutífera).`, 'error');
  } else {
    uiToast(`Rolagem: ${result.total}. Você encontrou uma nova pista!`, 'success');
  }
  loadInvestigationPoints();
}

init();
