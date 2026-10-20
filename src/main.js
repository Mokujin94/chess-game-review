import { Chess } from 'chess.js';
import { Chessground } from '@lichess-org/chessground';
import '@lichess-org/chessground/assets/chessground.base.css';
import '@lichess-org/chessground/assets/chessground.cburnett.css';
import { Engine } from './engine.js';
import { reviewGame, expectedPoints, lineCp, classifyLoss, terminalLines } from './review.js';
import { loadBook } from './openings.js';
import { LABELS, SYMBOLS, COLORS, explainBest, fmtEval, pct } from './explain.js';
import { fetchPgnById } from './chesscom.js';
import { coach, coachExplain } from './coach.js';
import * as speech from './speech.js';

const $ = (id) => document.getElementById(id);
const SAMPLE = `[White "Paul Morphy"]
[Black "Duke Karl / Count Isouard"]
[Result "1-0"]

1. e4 e5 2. Nf3 d6 3. d4 Bg4 4. dxe5 Bxf3 5. Qxf3 dxe5 6. Bc4 Nf6 7. Qb3 Qe7
8. Nc3 c6 9. Bg5 b5 10. Nxb5 cxb5 11. Bxb5+ Nbd7 12. O-O-O Rd8 13. Rxd7 Rxd7
14. Rd1 Qe6 15. Bxd7+ Nxd7 16. Qb8+ Nxb8 17. Rd8# 1-0`;

let engine;
let cg;
let data = null;
let cur = 0;
let flipped = false;
let ui = { show: null, why: false, step: 0, retry: null };
let voices = [];
let voice = null;
let voiceOn = false;
let speakTimer = null;

$('sample').onclick = () => ($('pgn').value = SAMPLE);
$('user').value = localStorage.getItem('cc_user') ?? '';
$('newbtn').onclick = () => {
  $('review').hidden = true;
  $('input').hidden = false;
  $('newbtn').hidden = true;
};

function setBusy(on, text) {
  $('load').disabled = $('run').disabled = on;
  $('progress').hidden = !on;
  if (on) {
    $('bar').style.width = '0';
    $('ptext').textContent = text ?? '';
  }
}

function showError(msg) {
  $('error').textContent = msg;
  $('error').hidden = false;
}

$('load').onclick = async () => {
  $('error').hidden = true;
  setBusy(true, 'Загружаю партию…');
  try {
    localStorage.setItem('cc_user', $('user').value.trim());
    const pgn = await fetchPgnById($('gameid').value, $('user').value, (s) => {
      $('ptext').textContent = s;
    });
    $('pgn').value = pgn;
    await analyze(pgn);
  } catch (e) {
    showError(e.message || String(e));
  } finally {
    setBusy(false);
  }
};

$('run').onclick = async () => {
  $('error').hidden = true;
  const pgn = $('pgn').value.trim();
  if (!pgn) return showError('Вставьте PGN');
  setBusy(true, 'Подготовка…');
  try {
    await analyze(pgn);
  } catch (e) {
    showError(e.message || String(e));
  } finally {
    setBusy(false);
  }
};

async function analyze(pgn) {
  engine ??= new Engine();
  const book = await loadBook().catch(() => null);
  data = await reviewGame(pgn, engine, {
    depth: Number($('depth').value),
    book,
    onProgress: (p) => {
      $('bar').style.width = `${Math.round(p * 100)}%`;
      $('ptext').textContent = `Анализ позиций… ${Math.round(p * 100)}%`;
    },
  });
  $('input').hidden = true;
  $('review').hidden = false;
  $('newbtn').hidden = false;
  flipped = false;
  initBoard();
  renderStatic();
  go(0);
  prefetchVoice();
}

function initBoard(extra = {}) {
  cg?.destroy();
  cg = Chessground($('board'), {
    fen: data.startFen,
    viewOnly: true,
    coordinates: true,
    animation: { duration: 180 },
    highlight: { lastMove: true },
    drawable: { enabled: true, visible: true },
    ...extra,
  });
}

function playerBar(color) {
  const h = data.headers;
  const name = h[color === 'w' ? 'White' : 'Black'] ?? (color === 'w' ? 'Белые' : 'Чёрные');
  const elo = h[color === 'w' ? 'WhiteElo' : 'BlackElo'];
  const r = h.Result;
  const res = r === '1-0' ? (color === 'w' ? 'Победа' : '') : r === '0-1' ? (color === 'b' ? 'Победа' : '') : r === '1/2-1/2' ? 'Ничья' : '';
  return `<span class="av">${color === 'w' ? '♔' : '♚'}</span>${name}${elo ? ` <span class="elo">(${elo})</span>` : ''}<span class="res">${res}</span>`;
}

function renderStatic() {
  const h = data.headers;
  $('nw').textContent = h.White ?? 'Белые';
  $('nb').textContent = h.Black ?? 'Чёрные';
  $('accw').textContent = data.white.accuracy.toFixed(1);
  $('accb').textContent = data.black.accuracy.toFixed(1);
  $('rw').textContent = `≈ ${data.white.rating} рейтинг партии`;
  $('rb').textContent = `≈ ${data.black.rating} рейтинг партии`;
  $('opening').textContent = data.opening ? `${data.opening.name} · ${data.opening.eco}` : '';
  updatePlayers();

  $('summary').innerHTML =
    `<table><tr><th></th><th>${h.White ?? 'Белые'}</th><th>${h.Black ?? 'Чёрные'}</th></tr>` +
    Object.keys(LABELS)
      .map((k) => {
        const w = data.white.counts[k] ?? 0;
        const b = data.black.counts[k] ?? 0;
        return `<tr class="${w + b ? '' : 'z'}"><td><span class="dot" style="background:${COLORS[k]}"></span>${LABELS[k]}</td><td>${w}</td><td>${b}</td></tr>`;
      })
      .join('') +
    '</table>';

  const el = $('moves');
  el.innerHTML = '';
  data.moves.forEach((m) => {
    if (m.color === 'w') {
      const n = document.createElement('div');
      n.className = 'n';
      n.textContent = `${Math.ceil(m.ply / 2)}.`;
      el.append(n);
    }
    const d = document.createElement('div');
    d.className = 'mv';
    d.dataset.ply = m.ply;
    d.innerHTML = `<span class="dot" style="background:${COLORS[m.cls]}"></span>${m.san}`;
    d.onclick = () => go(m.ply);
    el.append(d);
  });
}

function updatePlayers() {
  $('ptop').innerHTML = playerBar(flipped ? 'w' : 'b');
  $('pbot').innerHTML = playerBar(flipped ? 'b' : 'w');
}

let autoTimer = null;
const stopAuto = () => {
  clearInterval(autoTimer);
  autoTimer = null;
};
const curMove = () => (cur ? data.moves[cur - 1] : null);

const shapesOf = (arrows = [], circles = []) => [
  ...arrows.map((a) => ({ orig: a.slice(0, 2), dest: a.slice(2, 4), brush: 'green' })),
  ...circles.map((q) => ({ orig: q, brush: 'yellow' })),
];

function showBoard(fen, { arrows, circles, lastMove, check } = {}) {
  cg.set({
    fen,
    orientation: flipped ? 'black' : 'white',
    lastMove,
    check: check ?? false,
    drawable: { autoShapes: shapesOf(arrows, circles) },
  });
}

function baseBoard(m) {
  showBoard(m ? m.fen : data.startFen, {
    lastMove: m ? [m.from, m.to] : undefined,
    check: m ? new Chess(m.fen).inCheck() : false,
  });
}

// Автоповтор линии на доске: ход в секунду со стрелкой следующего хода.
function playLine(fen0, uci, onStep) {
  stopAuto();
  const c = new Chess(fen0);
  let i = 0;
  onStep?.(0);
  showBoard(fen0, { arrows: [uci[0]] });
  autoTimer = setInterval(() => {
    if (i >= uci.length) return stopAuto();
    const u = uci[i];
    try {
      c.move({ from: u.slice(0, 2), to: u.slice(2, 4), promotion: u[4] });
    } catch {
      return stopAuto();
    }
    i++;
    onStep?.(i);
    showBoard(c.fen(), { arrows: uci[i] ? [uci[i]] : [], lastMove: [u.slice(0, 2), u.slice(2, 4)], check: c.inCheck() });
  }, 1100);
}

// «Объяснить»: на доске разыгрывается продолжение после вашего хода (почему он плох).
function whyView(m, k) {
  const c = new Chess(m.fen);
  const ucis = m.replySteps.map((x) => x.uci);
  let last = [m.from, m.to];
  for (let i = 0; i < k && i < ucis.length; i++) {
    c.move({ from: ucis[i].slice(0, 2), to: ucis[i].slice(2, 4), promotion: ucis[i][4] });
    last = [ucis[i].slice(0, 2), ucis[i].slice(2, 4)];
  }
  return { fen: c.fen(), arrows: ucis[k] ? [ucis[k]] : [], lastMove: last, check: c.inCheck() };
}

function setWhyStep(k) {
  ui.step = k;
  document.querySelectorAll('.step').forEach((e) => e.classList.toggle('on', Number(e.dataset.k) === k));
}

function startWhy(m) {
  stopAuto();
  ui.why = true;
  ui.show = null;
  placeBadge(null);
  renderCoach(m);
  playLine(m.fen, m.replySteps.map((x) => x.uci), setWhyStep);
}

const showOf = (m, id) =>
  id === 'best'
    ? { fen: m.beforeFen, arrows: [m.bestUci], play: m.bestPvUci }
    : m.shows.find((x) => x.id === id);

// Статичный вид выбранного варианта (после ухода курсора с подсветки).
function restoreBoard() {
  const m = curMove();
  stopAuto();
  if (ui.retry) return;
  if (ui.why && m) {
    const v = whyView(m, ui.step);
    showBoard(v.fen, { arrows: v.arrows, lastMove: v.lastMove, check: v.check });
  } else if (ui.show && m) {
    const s = showOf(m, ui.show);
    showBoard(s.fen, { arrows: s.play ? [s.play[0]] : s.arrows, circles: s.circles });
  } else baseBoard(m);
}

function activateShow(m, id) {
  stopAuto();
  ui.show = ui.show === id ? null : id;
  ui.why = false;
  placeBadge(ui.show ? null : m);
  renderCoach(m);
  if (!ui.show) return baseBoard(m);
  const s = showOf(m, id);
  if (s.play) playLine(s.fen, s.play);
  else showBoard(s.fen, { arrows: s.arrows, circles: s.circles });
}

function go(ply, keepUi = false) {
  const next = Math.max(0, Math.min(data.moves.length, ply));
  if (!keepUi && (next !== cur || ui.retry)) {
    if (ui.retry) initBoard();
    ui = { show: null, why: false, step: 0, retry: null };
  }
  cur = next;
  stopAuto();
  const m = curMove();
  if (ui.retry) cg.set({ orientation: m.color === 'w' ? 'white' : 'black' });
  else restoreBoard();
  placeBadge(ui.retry || ui.show ? null : m);

  const cp = m ? m.evalWhite : data.startEval;
  $('evalfill').style.height = `${expectedPoints(cp) * 100}%`;
  $('evaltext').textContent = m?.mateWhite != null ? `M${Math.abs(m.mateWhite)}` : (cp / 100).toFixed(1);

  renderCoach(m);
  if (voiceOn && !ui.retry && !keepUi) {
    speakMove(m);
    prefetchVoice();
  }

  document.querySelectorAll('.mv').forEach((e) => {
    const on = Number(e.dataset.ply) === cur;
    e.classList.toggle('on', on);
    if (on) {
      const box = $('moves');
      if (e.offsetTop < box.scrollTop) box.scrollTop = e.offsetTop - 8;
      else if (e.offsetTop + e.offsetHeight > box.scrollTop + box.clientHeight) {
        box.scrollTop = e.offsetTop + e.offsetHeight - box.clientHeight + 8;
      }
    }
  });
  drawGraph();
}

function startRetry(m) {
  stopAuto();
  speech.stop();
  ui = { show: null, why: false, step: 0, retry: { result: null } };
  const c = new Chess(m.beforeFen);
  const dests = new Map();
  for (const mv of c.moves({ verbose: true })) {
    if (!dests.has(mv.from)) dests.set(mv.from, []);
    dests.get(mv.from).push(mv.to);
  }
  const color = m.color === 'w' ? 'white' : 'black';
  initBoard({
    fen: m.beforeFen,
    orientation: color,
    check: c.inCheck(),
    viewOnly: false,
    movable: { free: false, color, dests, showDests: true, events: { after: (from, to) => onRetryMove(m, from, to) } },
  });
  placeBadge(null);
  renderCoach(m);
}

async function onRetryMove(m, from, to) {
  const c = new Chess(m.beforeFen);
  const piece = c.get(from);
  const promotion = piece?.type === 'p' && (to[1] === '8' || to[1] === '1') ? 'q' : undefined;
  const mv = c.move({ from, to, promotion });
  const u = from + to + (promotion ?? '');
  cg.set({ movable: { color: undefined, dests: new Map() } });
  ui.retry.result = { pending: true };
  renderCoach(m);
  let res;
  if (u === m.bestUci) res = { kind: 'best', san: mv.san };
  else if (from === m.from && to === m.to) res = { kind: 'same', san: mv.san };
  else {
    const lines = c.isGameOver() ? terminalLines(c) : await engine.analyze(c.fen(), 12);
    const sign = m.color === 'w' ? 1 : -1;
    const loss = Math.max(0, m.beforeEP - expectedPoints(sign * lineCp(lines[0])));
    res = { kind: 'other', san: mv.san, loss, cls: classifyLoss(loss) };
  }
  if (!ui.retry) return;
  ui.retry.result = res;
  renderCoach(m);
}

function exitRetry() {
  initBoard();
  ui = { show: null, why: false, step: 0, retry: null };
  go(cur, true);
}

function retryHtml(m) {
  const r = ui.retry.result;
  if (!r) return `<div class="b">Найдите лучший ход за ${m.color === 'w' ? 'белых' : 'чёрных'}: сделайте ход на доске.</div>`;
  if (r.pending) return '<div class="b">Проверяю ваш ход…</div>';
  if (r.kind === 'best') {
    return `<div class="b"><b style="color:${COLORS.best}">Верно!</b> ${r.san} — лучший ход. Оценка позиции ${fmtEval(m.beforeEvalWhite, m.beforeMateWhite)} (с точки зрения белых).</div>`;
  }
  if (r.kind === 'same') {
    return `<div class="b">Это тот же ход, что был сыгран в партии: ${m.san} — ${LABELS[m.cls].toLowerCase()}. Попробуйте другой.</div>`;
  }
  return `<div class="b"><b style="color:${COLORS[r.cls]}">${LABELS[r.cls]}.</b> ${r.san}: потеря ${pct(r.loss)} шансов. ${r.cls === 'best' || r.cls === 'excellent' ? 'Почти так же хорошо, как лучший ход.' : `Лучше было ${m.bestSan}.`}</div>`;
}

function renderCoach(m) {
  const box = $('explain');
  if (!m) {
    box.innerHTML = `<div class="ico" style="background:#4a4742">♞</div><div><div class="t">Начало партии</div><div class="b">Листайте ходы стрелками или кликайте по списку и графику — под каждым ходом будет оценка и пояснение.</div></div>`;
    return;
  }
  const canBest = !m.isBest && m.bestSan && m.loss >= 0.02;
  if (ui.retry) {
    box.innerHTML =
      `<div class="ico" style="background:#4a4742">↻</div><div class="cbody"><div class="t">Повторить ход</div>${retryHtml(m)}` +
      `<div class="actions">${ui.retry.result && !ui.retry.result.pending ? '<button id="againbtn">↻ Ещё раз</button>' : ''}<button id="exitbtn">Выйти</button></div></div>`;
    $('exitbtn').onclick = exitRetry;
    if ($('againbtn')) $('againbtn').onclick = () => startRetry(m);
    return;
  }
  let html =
    `<div class="ico" style="background:${COLORS[m.cls]}">${SYMBOLS[m.cls]}</div><div class="cbody">` +
    `<div class="t" style="color:${COLORS[m.cls]}">${LABELS[m.cls]}${voice ? '<button id="speakbtn" class="ghost spk" title="Озвучить">🔊</button>' : ''}</div><div class="b">${m.text}</div>`;
  if (canBest) {
    const opts = [{ id: 'best', label: '★ Лучший ход' }, ...m.shows];
    html +=
      `<div class="actions">${opts.map((o) => `<button data-show="${o.id}" class="${ui.show === o.id ? 'on' : ''}">${o.label}</button>`).join('')}</div>` +
      `<div class="actions"><button id="whybtn" class="${ui.why ? 'on' : ''}">💡 Объяснить</button><button id="retrybtn">↻ Повторить</button></div>`;
    if (ui.show === 'best') {
      html += `<div class="bestline hl" data-play="1" title="Нажмите, чтобы проиграть линию"><b>${m.bestSan}</b> <span>${m.bestPv.slice(1).join(' ')}</span> <em>▶ показать</em></div>`;
    }
    if (ui.why) {
      const steps = [{ text: `Ваш ход: ${m.san}`, k: 0 }, ...m.replySteps.map((x, i) => ({ text: x.text, k: i + 1 }))];
      html +=
        `<div class="why"><div class="steps">${steps.map((x) => `<div class="step ${x.k === ui.step ? 'on' : ''}" data-k="${x.k}">${x.text}</div>`).join('')}</div>` +
        `<div class="whytext">${explainBest(m)}</div><div class="actions"><button id="replaybtn">▶ Ещё раз</button></div></div>`;
    }
  }
  box.innerHTML = html + '</div>';
  if ($('speakbtn')) $('speakbtn').onclick = () => speakMove(m, { now: true });
  if (canBest) {
    box.querySelectorAll('[data-show]').forEach((b) => {
      b.onclick = () => activateShow(m, b.dataset.show);
    });
    $('whybtn').onclick = () => {
      if (ui.why) {
        ui.why = false;
        stopAuto();
        renderCoach(m);
        baseBoard(m);
        placeBadge(m);
      } else startWhy(m);
      if (ui.why && voiceOn) speakMove(m, { explain: true, now: true });
    };
    $('retrybtn').onclick = () => startRetry(m);
    if ($('replaybtn')) $('replaybtn').onclick = () => startWhy(m);
    box.querySelectorAll('.step').forEach((el) => {
      el.onclick = () => {
        stopAuto();
        setWhyStep(Number(el.dataset.k));
        const v = whyView(m, ui.step);
        showBoard(v.fen, { arrows: v.arrows, lastMove: v.lastMove, check: v.check });
      };
    });
  }
}

// Подсветка слов в объяснении: наведение показывает позицию и стрелки на доске.
$('explain').addEventListener('mouseover', (e) => {
  const h = e.target.closest('.hl');
  if (!h || !data || ui.retry || h.dataset.play) return;
  stopAuto();
  showBoard(h.dataset.fen, {
    arrows: h.dataset.arrows.split(',').filter(Boolean),
    circles: h.dataset.circles.split(',').filter(Boolean),
  });
});
$('explain').addEventListener('mouseout', (e) => {
  const h = e.target.closest('.hl');
  if (h && !h.dataset.play && data && !ui.retry && !h.contains(e.relatedTarget)) restoreBoard();
});
$('explain').addEventListener('click', (e) => {
  const h = e.target.closest('.hl');
  if (h?.dataset.play && curMove()) playLine(curMove().beforeFen, curMove().bestPvUci);
});

function speakText(textRu) {
  if (!voice) return;
  const fallback = voices.find((v) => !v.cloud && speech.isRussian(v));
  speech.speak(speech.forVoice(textRu, voice), voice, fallback);
}

// Озвучка комментария к ходу (с задержкой, чтобы быстрый просмотр не заикался).
function speakMove(m, { explain = false, now = false } = {}) {
  clearTimeout(speakTimer);
  speech.stop();
  if (!m || !voice) return;
  const run = () => speakText(explain ? coachExplain(m, 'ru', true) : coach(m, 'ru', true));
  if (now) run();
  else speakTimer = setTimeout(run, 280);
}

// Заранее готовим озвучку ходов, начиная с текущего, пока пользователь читает.
function prefetchVoice() {
  if (!voiceOn || !voice?.cloud || !data) return;
  const order = data.moves.slice(cur, cur + 6);
  speech.prefetch(order.map((m) => speech.forVoice(coach(m, 'ru', true), voice)), voice);
}

function updateVoiceUi() {
  const t = $('vtoggle');
  t.classList.toggle('on', voiceOn);
  t.textContent = voiceOn ? '🔊 Озвучка' : '🔇 Озвучка';
}

async function initVoice() {
  if (!speech.supported) return;
  voices = await speech.getVoices();
  if (!voices.length) return;
  const tag = (v) => (v.cloud ? '' : speech.isRussian(v) ? 'системный' : /IN/i.test(v.lang) ? 'индийский акцент' : 'акцент');
  $('vsel').innerHTML = voices.map((v) => `<option value="${v.voiceURI}">${v.name}${tag(v) ? ` · ${tag(v)}` : ''}</option>`).join('');
  const saved = speech.savedVoiceUri();
  voice = voices.find((v) => v.voiceURI === saved) ?? voices[0];
  $('vsel').value = voice.voiceURI;
  voiceOn = speech.voiceEnabled();
  updateVoiceUi();
  $('voicebox').hidden = false;
  $('vsel').onchange = () => {
    voice = voices.find((v) => v.voiceURI === $('vsel').value);
    speech.saveVoiceUri(voice.voiceURI);
    speakMove(curMove(), { now: true });
    prefetchVoice();
  };
  $('vtoggle').onclick = () => {
    voiceOn = !voiceOn;
    speech.setVoiceEnabled(voiceOn);
    updateVoiceUi();
    if (voiceOn) {
      speakMove(curMove(), { now: true });
      prefetchVoice();
    } else {
      clearTimeout(speakTimer);
      speech.stop();
    }
  };
}
initVoice();

function placeBadge(m) {
  const b = $('badge');
  if (!m) return void (b.hidden = true);
  const f = 'abcdefgh'.indexOf(m.to[0]);
  const r = 8 - Number(m.to[1]);
  const x = flipped ? 7 - f : f;
  const y = flipped ? 7 - r : r;
  b.hidden = false;
  b.style.left = `${x * 12.5}%`;
  b.style.top = `${y * 12.5}%`;
  b.innerHTML = `<i style="background:${COLORS[m.cls]}">${SYMBOLS[m.cls]}</i>`;
}

function drawGraph() {
  const cv = $('graph');
  if (!data) return;
  const dpr = devicePixelRatio || 1;
  const w = (cv.width = cv.clientWidth * dpr);
  const h = (cv.height = 90 * dpr);
  const g = cv.getContext('2d');
  g.clearRect(0, 0, w, h);
  const pts = [data.startEval, ...data.moves.map((m) => m.evalWhite)].map((cp) => (1 - expectedPoints(cp)) * h);
  const x = (i) => (i / (pts.length - 1 || 1)) * w;
  g.fillStyle = '#f4f3ee';
  g.beginPath();
  g.moveTo(0, h);
  pts.forEach((y, i) => g.lineTo(x(i), y));
  g.lineTo(w, h);
  g.closePath();
  g.fill();
  g.strokeStyle = 'rgba(128,128,128,.55)';
  g.lineWidth = dpr;
  g.beginPath();
  g.moveTo(0, h / 2);
  g.lineTo(w, h / 2);
  g.stroke();
  data.moves.forEach((m, i) => {
    if (['mistake', 'blunder', 'brilliant'].includes(m.cls)) {
      g.fillStyle = COLORS[m.cls];
      g.beginPath();
      g.arc(x(i + 1), pts[i + 1], 3.5 * dpr, 0, 7);
      g.fill();
    }
  });
  g.strokeStyle = '#81b64c';
  g.lineWidth = 2 * dpr;
  g.beginPath();
  g.moveTo(x(cur), 0);
  g.lineTo(x(cur), h);
  g.stroke();
}

$('graph').onclick = (e) => {
  if (!data) return;
  const r = e.currentTarget.getBoundingClientRect();
  go(Math.round(((e.clientX - r.left) / r.width) * data.moves.length));
};
addEventListener('resize', () => data && drawGraph());

document.querySelectorAll('[data-nav]').forEach((b) => {
  b.onclick = () => {
    const k = b.dataset.nav;
    if (k === 'start') go(0);
    else if (k === 'prev') go(cur - 1);
    else if (k === 'next') go(cur + 1);
    else if (k === 'end') go(data.moves.length);
    else if (k === 'flip') {
      flipped = !flipped;
      updatePlayers();
      go(cur, true);
    }
  };
});

addEventListener('keydown', (e) => {
  if (!data || $('review').hidden || ['TEXTAREA', 'INPUT'].includes(e.target.tagName)) return;
  if (e.key === 'ArrowRight') go(cur + 1);
  if (e.key === 'ArrowLeft') go(cur - 1);
  if (e.key === 'Home') go(0);
  if (e.key === 'End') go(data.moves.length);
});
