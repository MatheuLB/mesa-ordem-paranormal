// Motor de dados de ORDEM PARANORMAL RPG 2 (playtest alpha "agentes").
//
// Regra base (pág. 18-20 do playtest): um teste rola um dado de perícia + um
// dado de atributo (d4 a d12) e soma os dois contra uma DT (7 por padrão).
// - Rolagem alta (RA) / Rolagem baixa (RB): o maior/menor resultado individual
//   entre os dados rolados, não a soma.
// - Crítico: 2+ dados com o MESMO valor, sendo esse valor >= 6 => sucesso automático.
// - Falha crítica: TODOS os dados vieram 1 => falha automática + efeito extra.
// - Dá pra rolar até 4 dados num teste, mas soma-se no máximo os 3 melhores.

const DIE_STEPS = [4, 6, 8, 10, 12, 20];

function stepDie(value, delta) {
  const i = DIE_STEPS.indexOf(value);
  if (i === -1) return value;
  const next = Math.min(DIE_STEPS.length - 1, Math.max(0, i + delta));
  return DIE_STEPS[next];
}

function rollDie(sides) {
  return 1 + Math.floor(Math.random() * sides);
}

// dice: array of { sides:number, label:string }
function performTest(dice, dt) {
  const rolled = dice.map(d => ({ ...d, value: rollDie(d.sides) }));

  let counted = rolled;
  let dropped = [];
  if (rolled.length > 3) {
    const sorted = [...rolled].sort((a, b) => b.value - a.value);
    counted = sorted.slice(0, 3);
    dropped = sorted.slice(3);
  }

  const total = counted.reduce((s, d) => s + d.value, 0);
  const values = counted.map(d => d.value);
  const ra = Math.max(...values);
  const rb = Math.min(...values);

  const valueCounts = {};
  values.forEach(v => { valueCounts[v] = (valueCounts[v] || 0) + 1; });
  const criticalSuccess = Object.entries(valueCounts).some(([v, c]) => Number(v) >= 6 && c >= 2);
  const criticalFail = values.every(v => v === 1) && values.length >= 2;

  const passed = (dt === null || dt === undefined || dt === '') ? null : total >= dt;

  return { rolled, counted, dropped, total, ra, rb, criticalSuccess, criticalFail, passed, dt: dt || null };
}

const CRIT_FAIL_TABLE = [
  { roll: 1, name: 'Vexame', text: 'Descreva a ação de forma vergonhosa. Sem efeito de regra, além da falha normal.' },
  { roll: 2, name: 'Machucado', text: 'Físico diminui um passo até o fim da cena.' },
  { roll: 3, name: 'Desatenção', text: 'Mente diminui um passo até o fim da cena.' },
  { roll: 4, name: 'Irritação', text: 'Emoção diminui um passo até o fim da cena.' },
  { roll: 5, name: 'Acidente', text: 'Perde 1d4 PV.' },
  { roll: 6, name: 'Frustração', text: 'Perde 1d4 PD.' },
  { roll: 7, name: 'Perda', text: 'Um item carregado (ou espaço de compra) se perde.' },
  { roll: 8, name: 'Nenhum efeito adicional', text: '' },
];

function rollCritFailTable() {
  const r = rollDie(8);
  return { roll: r, ...CRIT_FAIL_TABLE[r - 1] };
}
