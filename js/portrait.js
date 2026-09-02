// Retratos placeholder (sem arte externa): um ícone temático por perfil,
// dentro de uma moldura circular (fichas prontas) ou de um distintivo
// estilo policial (personagens gerados aleatoriamente, ver player.js).

const PROFILE_ICON = {
  Vigilante: '<path d="M12 5c-5 0-8.5 4.5-10 7 1.5 2.5 5 7 10 7s8.5-4.5 10-7c-1.5-2.5-5-7-10-7Zm0 11a4 4 0 1 1 0-8 4 4 0 0 1 0 8Z"/><circle cx="12" cy="12" r="1.6"/>',
  Analista: '<circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" stroke-width="1.8"/><line x1="15" y1="15" x2="20.5" y2="20.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>',
  Executor: '<path d="M7 13v-2a5 5 0 0 1 10 0v2h1.2a.8.8 0 0 1 .8.8v3.4a2.8 2.8 0 0 1-2.8 2.8H8a2.8 2.8 0 0 1-2.8-2.8v-3.4a.8.8 0 0 1 .8-.8H7Zm2-2v2h6v-2a3 3 0 0 0-6 0Z"/>',
};

function portraitSvg(profile, { generated = false, size = 64 } = {}) {
  const icon = PROFILE_ICON[profile] || PROFILE_ICON.Vigilante;
  if (generated) {
    // Distintivo estilo policial: escudo pentagonal com estrela de fundo.
    return `
      <svg viewBox="0 0 64 64" width="${size}" height="${size}" class="portrait-svg portrait-badge">
        <path class="badge-shape" d="M32 3 58 12 58 34C58 48 47 57 32 61 17 57 6 48 6 34L6 12Z"/>
        <g transform="translate(32,30) scale(1.05)">
          <path class="badge-star" d="M0 -16 3.5 -5 15 -5 5.8 1.9 9.3 13 0 6 -9.3 13 -5.8 1.9 -15 -5 -3.5 -5Z" opacity="0.25"/>
        </g>
        <g transform="translate(19,18) scale(1.15)" fill="currentColor">${icon}</g>
      </svg>`;
  }
  return `
    <svg viewBox="0 0 24 24" width="${size}" height="${size}" class="portrait-svg portrait-circle">
      <circle class="portrait-ring" cx="12" cy="12" r="11"/>
      <g fill="currentColor">${icon}</g>
    </svg>`;
}
