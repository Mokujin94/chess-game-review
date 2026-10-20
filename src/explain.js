// Шаблонные текстовые пояснения к ходам (без LLM) на основе данных движка.

export const LABELS = {
  brilliant: 'Блестящий ход',
  great: 'Отличный ход',
  best: 'Лучший ход',
  excellent: 'Очень хороший ход',
  good: 'Хороший ход',
  book: 'Теория',
  inaccuracy: 'Неточность',
  miss: 'Упущено',
  mistake: 'Ошибка',
  blunder: 'Грубая ошибка',
};

export const SYMBOLS = {
  brilliant: '!!',
  great: '!',
  best: '★',
  excellent: '👍',
  good: '✓',
  book: '📖',
  inaccuracy: '?!',
  miss: '✗',
  mistake: '?',
  blunder: '??',
};

export const COLORS = {
  brilliant: '#1baca6', great: '#5c8bb0', best: '#81b64c', excellent: '#96bc4b', good: '#a3a38f',
  book: '#a88865', inaccuracy: '#f7c631', miss: '#ff7769', mistake: '#e58f2a', blunder: '#ca3431',
};

const PIECE_ACC = { p: 'пешку', n: 'коня', b: 'слона', r: 'ладью', q: 'ферзя', k: 'короля' };

export const pct = (x) => `${Math.round(x * 100)}%`;

// Состояние позиции с точки зрения ходящего.
export function stateName(ep) {
  if (ep >= 0.85) return 'выигрышная';
  if (ep >= 0.65) return 'явно лучше';
  if (ep >= 0.55) return 'чуть лучше';
  if (ep > 0.45) return 'равная';
  if (ep > 0.35) return 'чуть хуже';
  if (ep > 0.15) return 'хуже';
  return 'проигрышная';
}

// Что делает ход: {san, captured, check, mate, promo, castle}
export function describeMove(d) {
  if (!d) return '';
  const parts = [];
  if (d.mate) parts.push('ставит мат');
  else if (d.check) parts.push('ставит шах');
  if (d.captured) parts.push(`забирает ${PIECE_ACC[d.captured]}`);
  if (d.promo) parts.push('проводит пешку в ферзи');
  if (d.castle) parts.push('делает рокировку');
  return parts.join(' и ');
}

export function explain(m) {
  const sentences = [];
  const bestDesc = describeMove(m.bestDesc);
  const bestTxt = m.bestSan
    ? `Лучше было ${m.bestSan}${bestDesc ? ` — ход ${bestDesc}` : ''}.`
    : '';
  const reply = m.replyDesc;
  let replyTxt = '';
  if (m.mateAgainst) {
    replyTxt = `Теперь у соперника мат в ${m.mateAgainst}.`;
  } else if (reply) {
    const act = describeMove(reply);
    replyTxt = act ? `Соперник отвечает ${reply.san} — ${act}.` : `Сильнейший ответ соперника — ${reply.san}.`;
  }
  const change =
    stateName(m.beforeEP) !== stateName(m.afterEP)
      ? `Позиция была ${stateName(m.beforeEP)}, стала ${stateName(m.afterEP)}.`
      : '';

  switch (m.cls) {
    case 'book':
      sentences.push(`${m.san} — теоретический ход.`, m.opening ? `${m.opening.name} (${m.opening.eco}).` : '');
      break;
    case 'brilliant':
      sentences.push(
        `${m.san} — красивая жертва!`,
        reply ? `Даже после ${reply.san} позиция остаётся ${stateName(m.afterEP)}.` : '',
      );
      break;
    case 'great':
      sentences.push(
        `${m.san} — единственный ход, который удерживает позицию.`,
        m.altLoss ? `Любая альтернатива теряет около ${pct(m.altLoss)} шансов.` : '',
      );
      break;
    case 'best':
      sentences.push(
        `${m.san} — лучший ход${bestDesc ? `: он ${bestDesc}` : ''}.`,
        m.bestMate ? `Ведёт к мату в ${m.bestMate}.` : `Позиция остаётся ${stateName(m.afterEP)}.`,
      );
      break;
    case 'excellent':
      sentences.push(`${m.san} — почти идеально.`, bestTxt);
      break;
    case 'good':
      sentences.push(`${m.san} — приемлемо, но неточно: потеряно ${pct(m.loss)} шансов.`, bestTxt);
      break;
    case 'miss':
      sentences.push(
        `Соперник ошибся${m.prevSan ? ` (${m.prevSan})` : ''}, но ${m.san} не использует шанс.`,
        change,
        bestTxt,
      );
      break;
    case 'inaccuracy':
    case 'mistake':
    case 'blunder':
      sentences.push(
        `${m.san} — ${LABELS[m.cls].toLowerCase()}: потеряно ${pct(m.loss)} шансов.`,
        change,
        replyTxt,
        bestTxt,
      );
      break;
  }
  return sentences.filter(Boolean).join(' ');
}


export const fmtEval = (cp, mate) => (mate != null ? `M${Math.abs(mate)}` : `${cp > 0 ? '+' : ''}${(cp / 100).toFixed(1)}`);

// Подсвеченное слово: при наведении на доске показываются позиция, стрелки и выделенные поля.
const hl = (text, { fen, arrows = [], circles = [] }) =>
  `<span class="hl" data-fen="${fen}" data-arrows="${arrows.join(',')}" data-circles="${circles.join(',')}">${text}</span>`;

function actionsHtml(d, uci, fen) {
  if (!d) return '';
  const parts = [];
  if (d.mate) parts.push('ставит мат');
  else if (d.check) parts.push('ставит шах');
  if (d.captured) {
    parts.push(hl(`забирает ${PIECE_ACC[d.captured]}`, { fen, arrows: [uci], circles: [uci.slice(2, 4)] }));
  }
  if (d.promo) parts.push('проводит пешку в ферзи');
  if (d.castle) parts.push('делает рокировку');
  return parts.join(' и ');
}

// Подробное объяснение (кнопка «Объяснить»): HTML с подсвеченными словами.
export function explainBest(m) {
  const out = [];
  const act = actionsHtml(m.bestDesc, m.bestUci, m.beforeFen);
  out.push(
    `${hl(m.bestSan, { fen: m.beforeFen, arrows: [m.bestUci] })}${act ? ` — ход, который ${act}` : ' — самый точный ход в позиции'}.`,
  );
  if (m.bestMate) out.push(`Он ведёт к мату в ${m.bestMate}.`);
  if (m.pvMaterial > 0) out.push(`По основной линии вы выигрываете материал: +${m.pvMaterial}.`);
  else if (m.pvMaterial < 0) out.push(`Линия требует отдать материал (${m.pvMaterial}), но позиция того стоит.`);
  out.push(
    `Оценка после него ${fmtEval(m.beforeEvalWhite, m.beforeMateWhite)}, после ${m.san} — ${fmtEval(m.evalWhite, m.mateWhite)} (с точки зрения белых).`,
  );
  if (m.mateAgainst) out.push(`${m.san} допускает мат в ${m.mateAgainst}.`);
  else if (m.replyDesc && m.replyUci) {
    const a = actionsHtml(m.replyDesc, m.replyUci, m.fen);
    out.push(
      `После ${m.san} у соперника появляется ${hl(m.replyDesc.san, { fen: m.fen, arrows: [m.replyUci] })}${a ? ` — он ${a}` : ''}.`,
    );
  }
  if (m.loss >= 0.01) out.push(`Вы теряете около ${pct(m.loss)} шансов относительно лучшего хода.`);
  out.push('Наведите курсор на выделенные слова, чтобы увидеть это на доске.');
  return out.join(' ');
}
