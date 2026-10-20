// Только страница игры с компьютером; не читает cookies, пароль или сетевые запросы.
let last = '';
setInterval(() => {
  const board = document.querySelector('wc-chess-board, chess-board');
  if (!board) return;
  const cells = new Map();
  for (const el of board.querySelectorAll('.piece')) {
    const piece = /(?:^|\s)([wb])([prnbqk])(?:\s|$)/.exec(el.className);
    const sq = /square-([1-8])([1-8])/.exec(el.className);
    if (!piece || !sq) continue;
    const key = sq[1] + sq[2];
    if (cells.has(key)) return; // анимация взятия ещё не закончилась
    cells.set(key, piece[1] === 'w' ? piece[2].toUpperCase() : piece[2]);
  }
  if (![...cells.values()].includes('K') || ![...cells.values()].includes('k')) return;
  const rows = [];
  for (let rank = 8; rank >= 1; rank--) {
    let row = '', empty = 0;
    for (let file = 1; file <= 8; file++) {
      const p = cells.get(`${file}${rank}`);
      if (!p) empty++;
      else { if (empty) row += empty; empty = 0; row += p; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const placement = rows.join('/');
  if (placement !== last) {
    last = placement;
    chrome.runtime.sendMessage({ type: 'BOT_BOARD', placement }).catch(() => {});
  }
  // Heartbeat: при открытии анализатора позже он тоже получит позицию.
  else chrome.runtime.sendMessage({ type: 'BOT_BOARD', placement }).catch(() => {});
}, 700);
