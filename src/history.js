import { Chess } from 'chess.js';
import { Engine } from './engine.js';
import { reviewGame } from './review.js';
import { LABELS, SYMBOLS } from './explain.js';
import { advanceBoard, positionKey, placementOf } from './history-core.js';

const $ = id => document.getElementById(id);
const storageKey = 'personal-history-v1';
let saved;
try { saved = JSON.parse(localStorage.getItem(storageKey)) || {}; } catch { saved = {}; }
let records = Array.isArray(saved.records) ? saved.records : [];
let processed = new Set(saved.processed || []);
let owner = saved.owner || '';
let connected = false, game = null, sourceTab = null;
$('history-user').value = owner || localStorage.getItem('cc_user') || '';
const status = text => { $('history-status').textContent = text; };
const persist = () => localStorage.setItem(storageKey, JSON.stringify({ owner, records, processed: [...processed] }));
status(`Сохранено позиций: ${records.length}.`);

async function json(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`API chess.com: ${r.status}`);
  return r.json();
}
$('history-import').onclick = async () => {
  const user = $('history-user').value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,50}$/.test(user)) return status('Введите ник chess.com.');
  $('history-import').disabled = true;
  let engine;
  try {
    if (owner !== user) { records = []; processed.clear(); owner = user; }
    const { archives } = await json(`https://api.chess.com/pub/player/${encodeURIComponent(user)}/games/archives`);
    const limit = Number($('history-limit').value);
    const games = [];
    for (const archive of [...archives].reverse()) {
      if (!/^https:\/\/api\.chess\.com\/pub\/player\/[a-z0-9_-]+\/games\/\d{4}\/\d{2}$/i.test(archive)) continue;
      status(`Загрузка архива ${archive.split('/').slice(-2).join('/')}…`);
      const data = await json(archive);
      games.push(...data.games.filter(g => g.rules === 'chess' && g.pgn && !processed.has(g.url)).reverse());
      if (games.length >= limit) break;
    }
    engine = new Engine();
    for (const [i, g] of games.slice(0, limit).entries()) {
      const color = g.white.username.toLowerCase() === user ? 'w' : 'b';
      const result = await reviewGame(g.pgn, engine, { depth: 10, onProgress: p => status(`Партия ${i + 1}/${Math.min(limit, games.length)}: ${Math.round(p * 100)}%`) });
      const date = new Date(g.end_time * 1000).toLocaleDateString('ru-RU');
      const opponent = color === 'w' ? g.black.username : g.white.username;
      records.push(...result.moves.filter(m => m.color === color).map(m => ({ key: positionKey(m.beforeFen), san: m.san, cls: m.cls, ply: m.ply, url: g.url, date, opponent })));
      processed.add(g.url);
      persist();
    }
    status(`Готово: ${processed.size} партий, ${records.length} ваших ходов. Анализ глубины 10, оценки приблизительные.`);
  } catch (e) { status(`Не удалось завершить импорт: ${e.message}. Уже обработанные партии сохранены.`); }
  finally { engine?.terminate(); $('history-import').disabled = false; }
};
$('history-connect').onclick = () => {
  connected = !connected;
  game = null; sourceTab = null;
  $('history-connect').textContent = connected ? 'Отключить бота' : 'Подключить бота';
  status(connected ? 'Жду новую партию с ботом. Откройте chess.com/play/computer с установленным расширением и начните с исходной позиции.' : 'Подключение отключено.');
};

window.addEventListener('message', e => {
  if (e.source !== window || e.origin !== location.origin || e.data?.channel !== 'chess-history-bot' || !connected) return;
  const { placement, sourceTab: tab } = e.data;
  if (typeof placement !== 'string' || placement.length > 100) return;
  if (sourceTab !== null && sourceTab !== tab) return;
  if (!game) {
    if (placement !== placementOf(new Chess().fen())) return status('Вижу доску бота. Начните новую партию: нужна исходная позиция для синхронизации.');
    game = new Chess(); sourceTab = tab;
  }
  const result = advanceBoard(game, placement);
  if (result === 'unsynced') { $('history-matches').replaceChildren(); return status('Пропущен ход или изменена позиция. Вернитесь к последнему ходу; если связь не восстановится, начните новую партию с ботом.'); }
  status(`Бот подключён · ${game.turn() === 'w' ? 'ход белых' : 'ход чёрных'} · ${game.history().length} полуходов.`);
  const matches = records.filter(r => r.key === positionKey(game.fen()));
  const box = $('history-matches');
  box.replaceChildren();
  if (!matches.length) { box.textContent = 'В загруженной истории такая позиция пока не встречалась.'; return; }
  for (const m of matches.slice(-12).reverse()) {
    const card = document.createElement('div'); card.className = 'history-match';
    const text = document.createElement('p');
    text.textContent = `${SYMBOLS[m.cls] || ''} Раньше вы сыграли ${m.san} — ${LABELS[m.cls] || m.cls}. ${m.date}, против ${m.opponent}, ход ${Math.ceil(m.ply / 2)}.`;
    card.append(text);
    if (/^https:\/\/www\.chess\.com\//.test(m.url)) {
      const a = document.createElement('a'); a.href = m.url; a.target = '_blank'; a.rel = 'noopener'; a.textContent = 'Открыть прошлую партию'; card.append(a);
    }
    box.append(card);
  }
});
