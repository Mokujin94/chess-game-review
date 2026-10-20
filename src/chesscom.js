// Загрузка PGN партии через официальный публичный API chess.com (api.chess.com/pub).
// API ищет партии по нику игрока, поэтому для id нужен ещё и ник.

const API = 'https://api.chess.com/pub/player';

export function parseGameId(input) {
  const m = /(\d{6,})\s*\/?\s*(?:\?.*)?$/.exec(input.trim());
  if (!m) throw new Error('Не удалось найти id партии. Вставьте ссылку вида chess.com/game/live/123456789');
  return m[1];
}

async function getJson(url) {
  const r = await fetch(url);
  if (r.status === 404) throw new Error('Игрок не найден');
  if (!r.ok) throw new Error(`chess.com ответил ${r.status}`);
  return r.json();
}

export async function fetchPgnById(input, username, onStatus) {
  const id = parseGameId(input);
  const user = username.trim().toLowerCase();
  if (!user) throw new Error('Укажите ник на chess.com');

  const { archives } = await getJson(`${API}/${user}/games/archives`);
  for (let i = archives.length - 1; i >= 0; i--) {
    const month = archives[i].split('/').slice(-2).join('.');
    onStatus?.(`Ищу партию… ${month}`);
    const { games } = await getJson(archives[i]);
    const g = games.find((x) => x.url?.split('/').pop() === id);
    if (g?.pgn) return g.pgn;
  }
  throw new Error('Партия не найдена в архивах этого игрока');
}
