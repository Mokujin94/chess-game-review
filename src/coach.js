// «Живой» комментарий тренера на русском и английском. Тексты собираются из фактов движка
// (метка, потеря шансов, лучший ход, ответ соперника), без LLM. Вариант фразы выбирается
// по номеру хода, чтобы комментарии не звучали одинаково.

const NAME = {
  ru: { p: 'пешка', n: 'конь', b: 'слон', r: 'ладья', q: 'ферзь', k: 'король' },
  en: { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' },
};
const ACC_RU = { p: 'пешку', n: 'коня', b: 'слона', r: 'ладью', q: 'ферзя', k: 'короля' };

const STATE = {
  ru: ['проигрышная', 'хуже', 'чуть хуже', 'равная', 'чуть лучше', 'явно лучше', 'выигрышная'],
  en: ['lost', 'worse', 'slightly worse', 'equal', 'slightly better', 'clearly better', 'winning'],
};
export function stateIndex(ep) {
  if (ep >= 0.85) return 6;
  if (ep >= 0.65) return 5;
  if (ep >= 0.55) return 4;
  if (ep > 0.45) return 3;
  if (ep > 0.35) return 2;
  if (ep > 0.15) return 1;
  return 0;
}

const FILE_RU = { a: 'а', b: 'бэ', c: 'цэ', d: 'дэ', e: 'е', f: 'эф', g: 'гэ', h: 'аш' };
const RANK_RU = ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь'];
const PIECE_RU = { K: 'король', Q: 'ферзь', R: 'ладья', B: 'слон', N: 'конь' };
const PROMO_RU = { Q: 'ферзя', R: 'ладью', B: 'слона', N: 'коня' };

// «Bxf6+» -> «слон берёт эф шесть, шах».
function sanWordsRu(san) {
  const check = san.includes('#') ? ', мат' : san.includes('+') ? ', шах' : '';
  let s = san.replace(/[+#]/g, '');
  if (/^O-O-O/.test(s)) return `длинная рокировка${check}`;
  if (/^O-O/.test(s)) return `короткая рокировка${check}`;
  const promo = /=([QRBN])/.exec(s);
  s = s.replace(/=[QRBN]/, '');
  const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])$/.exec(s);
  if (!m) return san;
  const [, piece, f, r, cap, file, rank] = m;
  const sq = `${FILE_RU[file]} ${RANK_RU[rank]}`;
  const from = `${f ? FILE_RU[f] : ''} ${r ? RANK_RU[r] : ''}`.trim();
  let out;
  if (piece) out = `${PIECE_RU[piece]} ${from} ${cap ? 'берёт' : 'на'} ${sq}`.replace(/\s+/g, ' ');
  else out = cap ? `пешка ${FILE_RU[f]} берёт ${sq}` : `пешка на ${sq}`;
  if (promo) out += `, превращается в ${PROMO_RU[promo[1]]}`;
  return out + check;
}

// SAN -> читаемая фраза: «Bxf6+» -> «bishop takes f 6, check».
export function sanWords(san, lang) {
  if (!san) return '';
  if (lang === 'ru') return sanWordsRu(san);
  const check = san.includes('#') ? ', checkmate' : san.includes('+') ? ', check' : '';
  let s = san.replace(/[+#]/g, '');
  if (/^O-O-O/.test(s)) return `castles queenside${check}`;
  if (/^O-O/.test(s)) return `castles kingside${check}`;
  const promo = /=([QRBN])/.exec(s);
  s = s.replace(/=[QRBN]/, '');
  const m = /^([KQRBN])?([a-h])?([1-8])?(x)?([a-h])([1-8])$/.exec(s);
  if (!m) return san;
  const [, piece, f, r, cap, file, rank] = m;
  const sq = `${file} ${rank}`;
  let out;
  if (piece) out = `${NAME.en[piece.toLowerCase()]} ${f ?? ''}${r ?? ''} ${cap ? 'takes' : 'to'} ${sq}`.replace(/\s+/g, ' ');
  else out = cap ? `${f} pawn takes ${sq}` : `pawn to ${sq}`;
  if (promo) out += `, promotes to ${NAME.en[promo[1].toLowerCase()]}`;
  return out + check;
}

const pick = (list, m) => list[m.ply % list.length];
const pc = (x) => Math.round(x * 100);

function parts(m, lang, speak) {
  const san = (s) => (speak ? sanWords(s, lang) : s);
  const ru = lang === 'ru';
  const bd = m.bestDesc;
  const rd = m.replyDesc;
  const bestWhat = bd
    ? [
        bd.mate && (ru ? 'ставит мат' : 'delivers checkmate'),
        !bd.mate && bd.check && (ru ? 'даёт шах' : 'gives check'),
        bd.captured && (ru ? `забирает ${ACC_RU[bd.captured]}` : `wins a ${NAME.en[bd.captured]}`),
        bd.promo && (ru ? 'проводит пешку в ферзи' : 'promotes the pawn'),
      ].filter(Boolean)
    : [];
  return {
    san: san(m.san),
    best: m.bestSan ? san(m.bestSan) : null,
    reply: rd ? san(rd.san) : null,
    prev: m.prevSan ? san(m.prevSan) : null,
    bestWhat: bestWhat.join(ru ? ' и ' : ' and '),
    replyCaptured: rd?.captured ? (ru ? ACC_RU[rd.captured] : NAME.en[rd.captured]) : null,
    before: STATE[lang][stateIndex(m.beforeEP)],
    after: STATE[lang][stateIndex(m.afterEP)],
    stateChanged: stateIndex(m.beforeEP) !== stateIndex(m.afterEP),
    loss: pc(m.loss),
    alt: m.altLoss ? pc(m.altLoss) : null,
    opening: m.opening?.name ?? null,
  };
}

export function coach(m, lang = 'ru', speak = false) {
  const p = parts(m, lang, speak);
  const ru = lang === 'ru';
  const bestTail = p.best
    ? ru
      ? ` Лучше было ${p.best}${p.bestWhat ? ` — он ${p.bestWhat}` : ''}.`
      : ` ${p.best} was better${p.bestWhat ? `, it ${p.bestWhat}` : ''}.`
    : '';
  const shift = p.stateChanged
    ? ru
      ? ` Позиция была ${p.before}, а стала ${p.after}.`
      : ` The position was ${p.before}, and now it is ${p.after}.`
    : '';
  let threat = '';
  if (m.mateAgainst) {
    threat = ru
      ? ` Теперь у соперника мат в ${m.mateAgainst}!`
      : ` Now your opponent has a forced mate in ${m.mateAgainst}!`;
  } else if (p.reply && p.replyCaptured) {
    threat = ru
      ? ` Соперник отвечает ${p.reply} и забирает ${p.replyCaptured}.`
      : ` Your opponent replies ${p.reply} and takes your ${p.replyCaptured}.`;
  } else if (p.reply) {
    threat = ru ? ` Сильнейший ответ соперника — ${p.reply}.` : ` The strongest reply is ${p.reply}.`;
  }

  const T = {
    ru: {
      book: [`${p.san} — классика. ${p.opening ?? 'Это теоретический ход'}.`, `Всё по теории: ${p.san}.${p.opening ? ` ${p.opening}.` : ''}`],
      brilliant: [
        `Вот это да! ${p.san} — блестящая жертва. Выглядит рискованно, но позиция остаётся ${p.after}.`,
        `Красиво! ${p.san} — жертва, которую оправдывает движок: позиция ${p.after}.`,
      ],
      great: [
        `${p.san} — единственный ход, который держит позицию.${p.alt ? ` Любой другой теряет около ${p.alt}% шансов.` : ''}`,
        `Отлично найдено! ${p.san} — тут нужно было играть только так.${p.alt ? ` Иначе вы теряете около ${p.alt}%.` : ''}`,
      ],
      best: [
        `${p.san} — лучший ход${p.bestWhat ? `: он ${p.bestWhat}` : ''}.${m.bestMate ? ` Это ведёт к мату в ${m.bestMate}.` : ` Позиция остаётся ${p.after}.`}`,
        `Точно в цель: ${p.san}.${m.bestMate ? ` Впереди мат в ${m.bestMate}!` : ''}`,
        `Именно так! ${p.san} — ход, который выбрал бы и движок.`,
      ],
      excellent: [`${p.san} — почти идеально.${bestTail}`, `Очень хороший ход, ${p.san}.${bestTail}`],
      good: [`${p.san} — неплохо, но неточно: уходит около ${p.loss}% шансов.${bestTail}`, `Нормальный ход, но можно сильнее.${bestTail}`],
      inaccuracy: [
        `${p.san} — небольшая неточность, минус ${p.loss}% шансов.${shift}${bestTail}`,
        `Хм, ${p.san} не самый сильный. Теряется около ${p.loss}%.${bestTail}`,
      ],
      mistake: [
        `Ой, ${p.san} — ошибка. Уходит ${p.loss}% шансов.${shift}${threat}${bestTail}`,
        `Это ошибка: ${p.san}.${shift}${threat}${bestTail}`,
      ],
      blunder: [
        `Ай-ай-ай! ${p.san} — грубая ошибка.${threat}${shift}${bestTail}`,
        `Вот тут беда: ${p.san} — зевок на ${p.loss}% шансов.${threat}${bestTail}`,
      ],
      miss: [
        `Соперник ошибся${p.prev ? ` (${p.prev})` : ''}, но ${p.san} упускает шанс.${bestTail}`,
        `Соперник дал возможность${p.prev ? ` ходом ${p.prev}` : ''}, а ${p.san} её не использует.${bestTail}`,
      ],
    },
    en: {
      book: [`${p.san}. Standard theory${p.opening ? `, the ${p.opening}` : ''}.`, `A well known move, ${p.san}.${p.opening ? ` This is the ${p.opening}.` : ''}`],
      brilliant: [
        `Wow! ${p.san} is a brilliant sacrifice. It looks risky, but you are still ${p.after}.`,
        `Beautiful! ${p.san}. The engine backs this sacrifice, the position is ${p.after}.`,
      ],
      great: [
        `${p.san} is the only move that holds everything together.${p.alt ? ` Anything else loses about ${p.alt} percent.` : ''}`,
        `Great find! ${p.san}. You had to play exactly this.${p.alt ? ` Otherwise you lose about ${p.alt} percent.` : ''}`,
      ],
      best: [
        `${p.san} is the best move${p.bestWhat ? `, it ${p.bestWhat}` : ''}.${m.bestMate ? ` It leads to mate in ${m.bestMate}.` : ` The position stays ${p.after}.`}`,
        `Right on target. ${p.san}.${m.bestMate ? ` Mate in ${m.bestMate} is coming!` : ''}`,
        `Exactly! ${p.san}. The engine would play the same.`,
      ],
      excellent: [`${p.san} is almost perfect.${bestTail}`, `Very good move, ${p.san}.${bestTail}`],
      good: [`${p.san} is fine, but not the most accurate. About ${p.loss} percent is lost.${bestTail}`, `A decent move, but you could do better.${bestTail}`],
      inaccuracy: [
        `${p.san} is a small inaccuracy, about ${p.loss} percent lost.${shift}${bestTail}`,
        `Hmm, ${p.san} is not the strongest. You lose about ${p.loss} percent.${bestTail}`,
      ],
      mistake: [
        `Oh, ${p.san} is a mistake. You lose ${p.loss} percent.${shift}${threat}${bestTail}`,
        `That is a mistake: ${p.san}.${shift}${threat}${bestTail}`,
      ],
      blunder: [
        `Oh no! ${p.san} is a blunder.${threat}${shift}${bestTail}`,
        `This is where it goes wrong. ${p.san} throws away ${p.loss} percent.${threat}${bestTail}`,
      ],
      miss: [
        `Your opponent slipped${p.prev ? ` with ${p.prev}` : ''}, but ${p.san} lets them off the hook.${bestTail}`,
        `Your opponent gave you a chance${p.prev ? ` with ${p.prev}` : ''}, and ${p.san} does not use it.${bestTail}`,
      ],
    },
  };
  return pick(T[lang][m.cls] ?? [`${p.san}.`], m).trim();
}

// Подробный разбор для озвучки по кнопке «Объяснить» (обычный текст, без HTML).
export function coachExplain(m, lang = 'ru', speak = true) {
  const p = parts(m, lang, speak);
  const ru = lang === 'ru';
  const out = [];
  if (p.best) {
    out.push(
      ru
        ? `Лучший ход здесь — ${p.best}${p.bestWhat ? `: он ${p.bestWhat}` : ''}.`
        : `The best move here is ${p.best}${p.bestWhat ? `, it ${p.bestWhat}` : ''}.`,
    );
  }
  if (m.bestMate) out.push(ru ? `Он ведёт к мату в ${m.bestMate}.` : `It leads to mate in ${m.bestMate}.`);
  if (m.pvMaterial > 0) {
    out.push(ru ? `По основной линии вы выигрываете материал: плюс ${m.pvMaterial}.` : `In the main line you win material, plus ${m.pvMaterial}.`);
  }
  if (m.mateAgainst) {
    out.push(ru ? `Ваш ход допускает мат в ${m.mateAgainst}.` : `Your move allows mate in ${m.mateAgainst}.`);
  } else if (p.reply) {
    out.push(
      p.replyCaptured
        ? ru
          ? `После вашего хода соперник играет ${p.reply} и забирает ${p.replyCaptured}.`
          : `After your move, your opponent plays ${p.reply} and takes your ${p.replyCaptured}.`
        : ru
          ? `После вашего хода сильнейший ответ — ${p.reply}.`
          : `After your move, the strongest reply is ${p.reply}.`,
    );
  }
  if (m.loss >= 0.01) {
    out.push(ru ? `В итоге вы теряете около ${p.loss}% шансов.` : `In total you lose about ${p.loss} percent.`);
  }
  return out.join(' ');
}
