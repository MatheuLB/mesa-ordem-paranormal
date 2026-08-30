# Mesa — Ordem Paranormal RPG II

Ferramenta de mesa (não-oficial) para jogar o playtest alpha "agentes" de
**Ordem Paranormal RPG II** (Jambô Editora) com seu grupo, no navegador.

- **`index.html`** — portal de entrada (jogador ou mestre)
- **`jogador.html`** — ficha do agente, rolador de dados e investigação
- **`mestre.html`** — painel do mestre: estado de todos os agentes em tempo
  real, controle de cena, notificações e pontos de interesse de investigação

## Como funciona

O site é estático (HTML/CSS/JS puro) e usa o [Supabase](https://supabase.com)
como backend, para que mestre e jogadores vejam o estado da mesa em tempo
real de qualquer dispositivo. Não há sistema de contas: cada jogador escolhe
seu nome e sua ficha, e o mestre entra com uma palavra de acesso simples
(definida em `js/master.js`).

## Rodando localmente

Basta servir a pasta com qualquer servidor estático, por exemplo:

```bash
npx http-server . -p 5544
```

## Regras implementadas

Baseado no resumo de regras do playtest: testes de perícia (dado de perícia +
dado de atributo, de d4 a d12, comparado contra uma DT — 7 por padrão),
rolagem alta/baixa, sucesso e falha crítica, PV/PD, e as mecânicas dos três
perfis (Vigilante, Analista, Executor) e das ocupações das fichas prontas
(Victor, Kênia, Eloísa, Edgar e Alan).
