// Visualizador do mapa da cena — página separada das fichas (etapa 1: só a
// imagem, sincronizada em tempo real). Tokens e neblina de guerra vêm depois.

let currentMap = null;

async function render() {
  const { data: session } = await supa.from('session_state').select('active_map_id, map_visible').eq('id', 1).single();

  if (!session?.map_visible || !session?.active_map_id) {
    showEmpty();
    return;
  }

  const { data: map } = await supa.from('maps').select('*').eq('id', session.active_map_id).single();
  if (!map) { showEmpty(); return; }

  currentMap = map;
  const img = document.getElementById('mapImage');
  img.src = map.image_url;
  img.style.display = 'block';
  document.getElementById('mapEmpty').style.display = 'none';
}

function showEmpty() {
  currentMap = null;
  document.getElementById('mapImage').style.display = 'none';
  document.getElementById('mapEmpty').style.display = 'block';
}

function subscribeMap() {
  supa.channel('map-viewer')
    .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'session_state' }, render)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'maps' }, render)
    .subscribe();
}

render();
subscribeMap();
