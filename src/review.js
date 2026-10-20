import { Chess } from 'chess.js';
import { coach } from './coach.js';
import { bookLookup } from './openings.js';

// Модель ожидаемых очков: оценка в сотых пешки -> шанс на результат (0..1).
const K = 0.00368208;
const MATE_CP = 10000;
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

export const lineCp = (l) =>
  l.mate != null ? Math.sign(l.mate) * (MATE_CP - Math.abs(l.mate) * 10) : l.cp;
export const expectedPoints = (cp) => 1 / (1 + Math.exp(-K * cp));

const uci = (m) => m.from + m.to + (m.promotion ?? '');
const clip = (cp, n = 1000) => Math.max(-n, Math.min(n, cp));

export function terminalLines(chess) {
  if (chess.isCheckmate()) {
    return [{ move: null, pv: [], cp: chess.turn() === 'w' ? -MATE_CP : MATE_CP, mate: null }];
  }
  return [{ move: null, pv: [], cp: 0, mate: null }];
}

function play(fen, u) {
  if (!u) return null;
  try {
    const c = new Chess(fen);
    const m = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return {
      san: m.san,
      captured: m.captured ?? null,
      check: m.san.includes('+'),
      mate: m.san.includes('#'),
      promo: Boolean(m.promotion),
      castle: m.flags.includes('k') || m.flags.includes('q'),
    };
  } catch {
    return null;
  }
}

function applyUci(fen, u) {
  if (!u) return null;
  try {
    const c = new Chess(fen);
    const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    return { fen: c.fen(), mv };
  } catch {
    return null;
  }
}

// Вилка: сходившая фигура бьёт две и более ценные фигуры (или одну с шахом).
function forkOf(fenAfter, mv) {
  const parts = fenAfter.split(' ');
  parts[1] = mv.color;
  parts[3] = '-';
  let c;
  try {
    c = new Chess(parts.join(' '));
  } catch {
    return null;
  }
  const targets = [
    ...new Set(
      c
        .moves({ square: mv.to, verbose: true })
        .filter((x) => x.captured && VALUE[x.captured] >= 3)
        .map((x) => x.to),
    ),
  ];
  const check = mv.san.includes('+');
  return targets.length >= 2 || (targets.length >= 1 && check) ? { from: mv.to, targets } : null;
}

function isSacrifice(move, afterLines) {
  const reply = afterLines[0]?.pv?.[0];
  if (!reply || move.piece === 'p' || move.piece === 'k') return false;
  const net = VALUE[move.piece] - (VALUE[move.captured] ?? 0);
  if (net < 2) return false;
  if (reply.slice(2, 4) !== move.to) return false;
  const c = new Chess(move.after);
  const r = c.moves({ verbose: true }).find((m) => uci(m) === reply);
  return Boolean(r?.captured);
}

export function classifyLoss(loss) {
  if (loss <= 0.005) return 'best';
  if (loss <= 0.02) return 'excellent';
  if (loss <= 0.05) return 'good';
  if (loss <= 0.1) return 'inaccuracy';
  if (loss <= 0.2) return 'mistake';
  return 'blunder';
}

// Грубая оценка рейтинга игры по среднему проигрышу в сотых пешки.
export const estimateRating = (acpl) => Math.round(Math.max(300, Math.min(3000, 3000 * Math.exp(-0.0202 * acpl))) / 10) * 10;

export async function reviewGame(pgn, engine, { depth = 14, book, onProgress } = {}) {
  const game = new Chess();
  game.loadPgn(pgn);
  const moves = game.history({ verbose: true });
  if (!moves.length) throw new Error('В PGN нет ходов');

  const fens = [moves[0].before, ...moves.map((m) => m.after)];
  const evals = [];
  for (let i = 0; i < fens.length; i++) {
    const c = new Chess(fens[i]);
    evals.push(c.isGameOver() ? terminalLines(c) : await engine.analyze(fens[i], depth));
    onProgress?.((i + 1) / fens.length);
  }

  const result = [];
  const prev = { w: null, b: null };
  let inBook = Boolean(book);
  let opening = null;
  moves.forEach((m, i) => {
    const sign = m.color === 'w' ? 1 : -1;
    const before = evals[i];
    const after = evals[i + 1];
    const bestEP = expectedPoints(sign * lineCp(before[0]));
    const secondEP = before[1] ? expectedPoints(sign * lineCp(before[1])) : null;
    const isBest = before[0].move === uci(m);
    const afterEP = isBest ? bestEP : expectedPoints(sign * lineCp(after[0]));
    const loss = isBest ? 0 : Math.max(0, bestEP - afterEP);
    const cpLoss = isBest
      ? 0
      : Math.max(0, clip(sign * lineCp(before[0])) - clip(sign * lineCp(after[0])));

    let cls = classifyLoss(loss);

    const opp = m.color === 'w' ? 'b' : 'w';
    let altLoss = null;
    if (cls === 'best' || cls === 'excellent') {
      if (isSacrifice(m, after) && afterEP >= 0.5 && bestEP < 0.95) cls = 'brilliant';
      else if (isBest && secondEP != null && bestEP - secondEP >= 0.15 && bestEP < 0.97) {
        cls = 'great';
        altLoss = bestEP - secondEP;
      }
    } else if (prev[opp] && prev[opp].loss >= 0.1 && loss >= 0.05 && loss < 0.2 && bestEP >= 0.6) {
      cls = 'miss';
    }

    if (inBook) {
      const hit = bookLookup(book, m.after);
      if (hit && loss < 0.1) {
        cls = 'book';
        opening = hit;
      } else inBook = false;
    }
    prev[m.color] = { loss, san: m.san };

    const bestPv = [];
    let pvMaterial = 0;
    {
      const c = new Chess(fens[i]);
      for (const u of before[0].pv.slice(0, 6)) {
        try {
          const mv = c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
          bestPv.push(mv.san);
          if (mv.captured) pvMaterial += (mv.color === m.color ? 1 : -1) * VALUE[mv.captured];
        } catch {
          break;
        }
      }
    }
    const bestDesc = play(fens[i], before[0].move);
    const replyDesc = play(m.after, after[0]?.move);
    const mateAfter = after[0].mate != null ? after[0].mate * sign : null;
    const entry = {
      ply: i + 1,
      color: m.color,
      san: m.san,
      from: m.from,
      to: m.to,
      fen: m.after,
      cls,
      loss,
      cpLoss,
      beforeEP: bestEP,
      afterEP,
      altLoss,
      accuracy: Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * loss * 100) - 3.1669)),
      evalWhite: lineCp(after[0]),
      mateWhite: after[0].mate,
      bestSan: bestDesc?.san ?? null,
      bestUci: before[0].move,
      isBest,
      bestPv,
      replyPvUci: (after[0]?.pv ?? []).slice(0, 6),
      bestPvUci: before[0].pv.slice(0, bestPv.length),
      beforeFen: fens[i],
      pvMaterial,
      beforeEvalWhite: lineCp(before[0]),
      beforeMateWhite: before[0].mate,
      bestDesc,
      replyDesc,
      replyUci: after[0]?.move ?? null,
      mateAgainst: mateAfter != null && mateAfter < 0 ? Math.abs(mateAfter) : null,
      bestMate: before[0].mate != null && before[0].mate * sign > 0 ? Math.abs(before[0].mate) : null,
      prevSan: prev[opp]?.san ?? null,
      opening,
    };
    const shows = [];
    if (entry.bestPvUci.length > 1) {
      shows.push({ id: 'idea', label: '💡 Идея', fen: fens[i], arrows: entry.bestPvUci.slice(0, 4) });
    }
    if (entry.bestMate) shows.push({ id: 'mate', label: '♚ Мат', fen: fens[i], play: entry.bestPvUci });
    const bestApplied = applyUci(fens[i], entry.bestUci);
    const bf = bestApplied && forkOf(bestApplied.fen, bestApplied.mv);
    if (bf) {
      shows.push({
        id: 'fork', label: '⑂ Вилка', fen: bestApplied.fen,
        arrows: bf.targets.map((t) => bf.from + t), circles: bf.targets,
      });
    }
    if (loss >= 0.05) {
      if (entry.mateAgainst && entry.replyPvUci.length) {
        shows.push({ id: 'mateagainst', label: '☠ Угроза мата', fen: m.after, play: entry.replyPvUci });
      } else if (replyDesc?.captured && entry.replyUci) {
        shows.push({
          id: 'lost', label: '⚠ Потеря фигуры', fen: m.after,
          arrows: [entry.replyUci], circles: [entry.replyUci.slice(2, 4)],
        });
      }
      const ra = applyUci(m.after, entry.replyUci);
      const rf = ra && forkOf(ra.fen, ra.mv);
      if (rf) {
        shows.push({
          id: 'oppfork', label: '⑂ Вилка соперника', fen: ra.fen,
          arrows: rf.targets.map((t) => rf.from + t), circles: rf.targets,
        });
      }
    }
    entry.shows = shows;
    entry.text = coach(entry, 'ru');
    result.push(entry);
  });

  const side = (c) => {
    const list = result.filter((r) => r.color === c);
    const counts = {};
    list.forEach((r) => (counts[r.cls] = (counts[r.cls] ?? 0) + 1));
    const acpl = list.reduce((s, r) => s + r.cpLoss, 0) / (list.length || 1);
    return {
      accuracy: list.reduce((s, r) => s + r.accuracy, 0) / (list.length || 1),
      rating: estimateRating(acpl),
      counts,
    };
  };

  return {
    moves: result,
    startFen: fens[0],
    startEval: lineCp(evals[0][0]),
    white: side('w'),
    black: side('b'),
    headers: game.getHeaders(),
    opening: result.findLast((r) => r.opening)?.opening ?? null,
  };
}
