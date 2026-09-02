// Gerador de personagem aleatório — homebrew, pois o playtest ainda não traz
// regras de criação de personagem (só fichas prontas). Segue o padrão
// observado nas 5 fichas prontas: nível 2, atributos somando 22 usando os
// valores {10,6,6} ou {8,8,6} distribuídos entre Físico/Mente/Emoção.

const SKILL_DEFS = [
  { name: 'Acrobacia', attr: 'fisico' }, { name: 'Aptidão', attr: 'mente' },
  { name: 'Atletismo', attr: 'fisico' }, { name: 'Crime', attr: 'fisico' },
  { name: 'Disciplina', attr: 'emocao' }, { name: 'Enganação', attr: 'emocao' },
  { name: 'Furtividade', attr: 'fisico' }, { name: 'Intimidar', attr: 'emocao' },
  { name: 'Intuição', attr: 'emocao' }, { name: 'Luta', attr: 'fisico' },
  { name: 'Máquinas', attr: 'mente' }, { name: 'Medicina', attr: 'mente' },
  { name: 'Ocultismo', attr: 'mente' }, { name: 'Percepção', attr: 'mente' },
  { name: 'Persuasão', attr: 'emocao' }, { name: 'Pesquisar', attr: 'mente' },
  { name: 'Pontaria', attr: 'fisico' }, { name: 'Sobrevivência', attr: 'mente' },
  { name: 'Tecnologia', attr: 'mente' }, { name: 'Vigor', attr: 'fisico' },
];

const FIRST_NAMES = ['Bianca','Caio','Diana','Elias','Fabiana','Gustavo','Helena','Igor','Julia','Kleber','Lucas','Marina','Nando','Otávia','Paulo','Renata','Sérgio','Tânia','Ulisses','Vera'];
const LAST_NAMES = ['Aguiar','Barreto','Cordeiro','Dantas','Esteves','Farias','Guimarães','Hortêncio','Ibrahim','Junqueira','Klein','Lacerda','Mafra','Nogueira','Orsini','Pimentel','Quintana','Ribas','Salgado','Teixeira'];

const OCCUPATIONS = {
  Vigilante: ['Policial', 'Detetive Particular', 'Segurança Patrimonial', 'Vigia Noturno'],
  Analista: ['Bibliotecário', 'Contador Forense', 'Jornalista Investigativo', 'Perito Criminal'],
  Executor: ['Ex-militar', 'Lutador', 'Motorista de Aplicativo', 'Bombeiro'],
};

const PROFILE_ABILITIES = {
  Vigilante: [{ source: 'Perfil: Vigilante', title: 'Prontidão', text: 'No início de qualquer conflito, você pode gastar 3 PD. Se fizer isso, ganha uma rodada na qual pode agir antes dos demais personagens e NPCs.' }],
  Analista: [{ source: 'Perfil: Analista', title: 'Avaliação', text: 'Você pode gastar uma ação e 2 PD para observar um ser ou um ambiente. Você recebe dois dados bônus que pode usar em testes relativos àquele ser ou ambiente (pode usá-los como quiser: +2 dados bônus em um teste ou +1 dado bônus em dois testes). Não pode acumular mais do que dois dados bônus por esta habilidade.' }],
  Executor: [{ source: 'Perfil: Executor', title: 'Ímpeto', text: 'Você possui uma barra de ímpeto com três espaços. Sempre que falha em um teste, você preenche um espaço na barra. Pode apagar espaços preenchidos para: (1 espaço) receber +1d4 em um teste; (3 espaços) aumentar um atributo em um passo até o fim da cena.' }],
};

const THEME_BY_PROFILE = { Vigilante: 'green', Analista: 'blue', Executor: 'red' };

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function shuffle(arr) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1));[a[i], a[j]] = [a[j], a[i]]; } return a; }

function generateRandomCharacter() {
  const profile = pick(['Vigilante', 'Analista', 'Executor']);
  const occupation = pick(OCCUPATIONS[profile]);

  const pattern = pick([[10, 6, 6], [8, 8, 6]]);
  const [fisico, mente, emocao] = shuffle(pattern);

  const skillOrder = shuffle(SKILL_DEFS.map((_, i) => i));
  const d8Idx = new Set(skillOrder.slice(0, 1));
  const d6Idx = new Set(skillOrder.slice(1, 7));
  const skills = SKILL_DEFS.map((s, i) => ({
    name: s.name, attr: s.attr,
    die: d8Idx.has(i) ? 8 : d6Idx.has(i) ? 6 : 4,
  }));

  const abilities = [...PROFILE_ABILITIES[profile]];
  const attrNames = { fisico: 'Físico', mente: 'Mente', emocao: 'Emoção' };
  if (Math.random() < 0.6) {
    const focoAttr = pick(['fisico', 'mente', 'emocao']);
    const focoLabel = { fisico: 'Físico', mente: 'Mental', emocao: 'Emocional' }[focoAttr];
    abilities.push({
      source: `Ocupação: ${occupation}`, title: `Foco ${focoLabel}`,
      text: `Quando faz um teste ${focoLabel === 'Físico' ? 'físico' : focoLabel.toLowerCase()}, você pode gastar 2 PD para receber +1d4 no teste.`,
    });
  } else {
    const bumpedAttr = pick(['fisico', 'mente', 'emocao']);
    abilities.push({
      source: `Ocupação: ${occupation}`, title: 'Formação Especializada',
      text: `Sua experiência como ${occupation.toLowerCase()} já está refletida nas perícias de ${attrNames[bumpedAttr]} acima.`,
    });
  }

  const impeto_max = profile === 'Executor' ? 3 : 0;

  return {
    slug: 'gen-' + Math.random().toString(36).slice(2, 9),
    name: `${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`,
    profile, occupation, level: 2,
    fisico, mente, emocao,
    pv_max: 8 + fisico, pv_current: 8 + fisico,
    pd_max: 8 + emocao, pd_current: 8 + emocao,
    skills, abilities,
    impeto_max, impeto_used: 0, avaliacao_dice: 0,
    theme_color: THEME_BY_PROFILE[profile],
    is_generated: true, inventory: [], notes: '',
  };
}
