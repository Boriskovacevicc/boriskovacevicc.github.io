import { Chess } from './vendor/chess.js';

/* =========================================================
   Boki Chess — pass-and-play chess with Stockfish eval & hints
   ========================================================= */
const $ = (id) => document.getElementById(id);
const STORE = 'boki-chess-v1';
const EVAL_LIMIT = { depth: 15, movetime: 1200 };   // live eval: light enough for iPad
const HINT_LIMIT = { depth: 20, movetime: 2500 };   // hint: stronger search
const FILES = 'abcdefgh';
const NAMES = { p: 'pawn', n: 'knight', b: 'bishop', r: 'rook', q: 'queen', k: 'king' };
const VAL = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };

/* ---------------- Engine wrapper ---------------- */
class Engine {
  constructor(url) {
    this.url = url; this.worker = null; this.ready = false; this.readyCbs = [];
    this.current = null; this.pending = null; this.failed = false;
  }
  start() {
    if (this.worker || this.failed) return;
    try { this.worker = new Worker(this.url); }
    catch (e) { this.failed = true; console.error('engine failed', e); return; }
    this.worker.onmessage = (e) => this.onLine(String(e.data));
    this.worker.onerror = (e) => { console.error('engine error', e); this.failed = true; };
    this.send('uci');
  }
  send(cmd) { this.worker && this.worker.postMessage(cmd); }
  onLine(line) {
    if (line === 'uciok') { this.send('setoption name Hash value 32'); this.send('isready'); return; }
    if (line === 'readyok') {
      if (!this.ready) { this.ready = true; window.__engineReady = true; this.readyCbs.splice(0).forEach((f) => f()); }
      return;
    }
    if (line.startsWith('info') && this.current && !this.current.stopping) {
      const info = parseInfo(line, this.current.fen);
      if (info) { this.current.last = info; this.current.onInfo && this.current.onInfo(info); }
      return;
    }
    if (line.startsWith('bestmove')) {
      const job = this.current; this.current = null;
      if (job && !job.stopping) job.onDone && job.onDone(line.split(' ')[1], job.last);
      if (this.pending) { const p = this.pending; this.pending = null; this.begin(p); }
    }
  }
  whenReady(f) { this.ready ? f() : this.readyCbs.push(f); }
  /** Run a search; any running/queued search is cancelled (its callbacks never fire). */
  analyze(fen, limit, onInfo, onDone) {
    const job = { fen, limit, onInfo, onDone, stopping: false, last: null };
    this.latest = job;
    this.start();
    this.whenReady(() => {
      if (job.cancelled || job !== this.latest) return;
      if (this.current) {
        if (this.pending) this.pending.cancelled = true;
        this.pending = job;
        if (!this.current.stopping) { this.current.stopping = true; this.send('stop'); }
      } else this.begin(job);
    });
    return job;
  }
  begin(job) {
    if (job.cancelled) return;
    this.current = job;
    this.send('position fen ' + job.fen);
    this.send(`go depth ${job.limit.depth} movetime ${job.limit.movetime}`);
  }
  cancel() {
    this.latest = null;
    if (this.pending) { this.pending.cancelled = true; this.pending = null; }
    if (this.current && !this.current.stopping) { this.current.stopping = true; this.send('stop'); }
  }
  newGame() { this.cancel(); if (this.worker) this.whenReady(() => { this.send('ucinewgame'); }); }
}
function parseInfo(line, fen) {
  const m = line.match(/ depth (\d+).* score (cp|mate) (-?\d+)/);
  if (!m || / multipv (?!1 )/.test(line)) return null;
  const white = fen.split(' ')[1] === 'w';
  let v = parseInt(m[3], 10); if (!white) v = -v;      // convert to White's perspective
  const pv = (line.match(/ pv (.+)$/) || [])[1];
  return { depth: +m[1], type: m[2], value: v, pv: pv ? pv.split(' ') : [] };
}
const engine = new Engine('vendor/sf-worker.js#stockfish-19-lite-single.wasm');
window.__engine = engine;

/* ---------------- State ---------------- */
let chess = new Chess();
let S = null;            // persisted game state
let selected = null;     // selected square
let legalFromSel = [];
let hint = null;         // {from,to}
let hintBusy = false;
let evalJob = null;
let shownTurn = 'w';     // turn used for orientation (lags slightly for animation)
let lastEval = null;
let animateFrom = null;  // {from,to} to slide
let pendingPromo = null;
let skipSlide = false;

const defaults = () => ({
  names: { w: '', b: '' }, hintsStart: { w: 3, b: 3 }, hints: { w: 3, b: 3 },
  moves: [], evalOn: false, autoFlip: true, flipStyle: 'table', over: false, result: null,
});
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
const nameOf = (c) => (S.names[c] || (c === 'w' ? 'White' : 'Black'));

/* ---------------- Setup screen ---------------- */
function initSetup() {
  const saved = load();
  const prev = saved || defaults();
  $('nameW').value = prev.names?.w || ''; $('nameB').value = prev.names?.b || '';
  $('hintsW').value = prev.hintsStart?.w ?? 3; $('hintsB').value = prev.hintsStart?.b ?? 3;
  $('optEval').checked = !!prev.evalOn;  // default OFF
  $('optFlip').checked = prev.autoFlip !== false;
  setFlipStyle(prev.flipStyle || 'table');
  const upd = () => { $('hintsWVal').textContent = $('hintsW').value; $('hintsBVal').textContent = $('hintsB').value; };
  $('hintsW').oninput = upd; $('hintsB').oninput = upd; upd();
  $('flipStyle').querySelectorAll('button').forEach((b) => (b.onclick = () => setFlipStyle(b.dataset.v)));
  $('resumeBtn').classList.toggle('hidden', !(saved && saved.moves && saved.moves.length && !saved.over));
  $('resumeBtn').onclick = () => startGame(saved);
  $('startBtn').onclick = () => {
    const st = defaults();
    st.names = { w: $('nameW').value.trim(), b: $('nameB').value.trim() };
    st.hintsStart = { w: +$('hintsW').value, b: +$('hintsB').value };
    st.hints = { ...st.hintsStart };
    st.evalOn = $('optEval').checked; st.autoFlip = $('optFlip').checked;
    st.flipStyle = $('flipStyle').querySelector('.on').dataset.v;
    startGame(st);
  };
}
function setFlipStyle(v) {
  $('flipStyle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('flipStyleHelp').textContent = v === 'table'
    ? 'Sitting across a table: the pieces turn to face whoever is to move'
    : 'Handing the iPad over: the whole board turns round';
}
function showSetup() { engine.cancel(); $('game').classList.add('hidden'); $('setup').classList.remove('hidden'); initSetup(); }

/* ---------------- Game lifecycle ---------------- */
function startGame(st) {
  S = Object.assign(defaults(), st);
  chess = new Chess();
  for (const m of S.moves) { try { chess.move(m); } catch (e) { break; } }
  S.moves = chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion }));
  selected = null; hint = null; hintBusy = false; lastEval = null; animateFrom = null;
  shownTurn = chess.turn();
  engine.newGame();
  if (S.evalOn || S.hints.w + S.hints.b > 0) engine.start(); // warm up the engine
  $('setup').classList.add('hidden'); $('game').classList.remove('hidden');
  $('gEval').checked = S.evalOn; $('gFlip').checked = S.autoFlip;
  layout(); applyOrientation(true); render(); save();
  afterPositionChange(false);
  if (S.over) showGameOver();
}

function afterPositionChange(animate = true) {
  hint = null; selected = null; legalFromSel = [];
  checkGameOver();
  render();
  if (animate) setTimeout(() => { shownTurn = chess.turn(); applyOrientation(); renderCards(); }, 170);
  else { shownTurn = chess.turn(); applyOrientation(); renderCards(); }
  requestEval();
  save();
}

function doMove(from, to, promotion) {
  if (S.over) return false;
  let mv;
  try { mv = chess.move({ from, to, promotion }); } catch (e) { return false; }
  if (!mv) return false;
  engine.cancel(); hintBusy = false;
  S.moves.push({ from: mv.from, to: mv.to, promotion: mv.promotion });
  animateFrom = skipSlide ? {} : { from: mv.from, to: mv.to };
  if (mv.flags.includes('k')) animateFrom.rook = mv.color === 'w' ? ['h1', 'f1'] : ['h8', 'f8'];
  if (mv.flags.includes('q')) animateFrom.rook = mv.color === 'w' ? ['a1', 'd1'] : ['a8', 'd8'];
  afterPositionChange(true);
  if (S.over) setTimeout(showGameOver, 650);
  return true;
}

function checkGameOver() {
  S.over = chess.isGameOver();
  if (!S.over) { S.result = null; return; }
  if (chess.isCheckmate()) {
    const winner = chess.turn() === 'w' ? 'b' : 'w';
    S.result = { score: winner === 'w' ? '1-0' : '0-1', title: `Checkmate! ${nameOf(winner)} wins`, text: `${nameOf(winner)} (${winner === 'w' ? 'White' : 'Black'}) checkmated ${nameOf(chess.turn())}.` };
  } else {
    let why = 'Draw';
    if (chess.isStalemate()) why = 'Stalemate';
    else if (chess.isThreefoldRepetition()) why = 'Threefold repetition';
    else if (chess.isInsufficientMaterial()) why = 'Insufficient material';
    else if (chess.isDrawByFiftyMoves()) why = '50-move rule';
    S.result = { score: '½-½', title: 'Draw', text: `${why}. Nobody wins this one.` };
  }
}

/* ---------------- Layout & orientation ---------------- */
function layout() {
  const w = window.innerWidth, h = window.innerHeight;
  const evalW = S && S.evalOn ? 50 : 0;
  let b;
  if (w > h) b = Math.min(h - 2 * 82 - 20 - 24, w - 330 - 24 - evalW - 40);
  else b = Math.min(w - 48 - evalW - 8, h - 2 * 82 - 20 - 220 - 24);
  b = Math.max(240, Math.floor(b / 8) * 8);
  document.documentElement.style.setProperty('--board', b + 'px');
}
window.addEventListener('resize', () => { if (S) layout(); });

function orient() {
  const flip = S.autoFlip && shownTurn === 'b';
  // table: only the pieces turn. pass: the whole board turns and pieces counter-turn so they stay upright.
  return { boardRot: S.flipStyle === 'pass' && flip, pieceRot: flip };
}
function applyOrientation() {
  const o = orient();
  $('stage').classList.toggle('rot', o.boardRot);
  $('board').classList.toggle('prot', o.pieceRot);
  renderEvalText();
}

/* ---------------- Rendering ---------------- */
function sqName(r, f) { return FILES[f] + (8 - r); }   // r: 0 = rank 8 (white orientation)
function render() {
  renderBoard(); renderArrows(); renderMoves(); renderStatus(); renderCards(); renderEvalBar();
  $('undoBtn').disabled = S.moves.length === 0;
}
function renderBoard() {
  const box = $('squares');
  const last = S.moves.length ? S.moves[S.moves.length - 1] : null;
  const checkSq = chess.inCheck() ? findKing(chess.turn()) : null;
  const targets = new Map(legalFromSel.map((m) => [m.to, m]));
  const board = chess.board();
  let html = '';
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) {
    const sq = sqName(r, f), p = board[r][f];
    const cls = ['sq', (r + f) % 2 ? 'd' : 'l'];
    if (last && (sq === last.from || sq === last.to)) cls.push('last');
    if (sq === selected) cls.push('sel');
    if (hint && (sq === hint.from || sq === hint.to)) cls.push('hint');
    if (sq === checkSq) cls.push('check');
    html += `<div class="${cls.join(' ')}" data-sq="${sq}">`;
    if (f === 0) html += `<span class="co r">${8 - r}</span>`;
    if (r === 7) html += `<span class="co f">${FILES[f]}</span>`;
    if (p) html += `<div class="pc" data-p="${p.color}${p.type}"><img src="pieces/${p.color}${p.type.toUpperCase()}.svg" alt="${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}" draggable="false"></div>`;
    if (targets.has(sq)) html += `<div class="mv${(p || targets.get(sq).flags.includes('e')) ? ' cap' : ''}"></div>`;
    html += '</div>';
  }
  box.innerHTML = html;
  if (animateFrom) { if (animateFrom.from) { slide(animateFrom.from, animateFrom.to); if (animateFrom.rook) slide(...animateFrom.rook); } animateFrom = null; }
}
function sqXY(sq) { return { f: FILES.indexOf(sq[0]), r: 8 - +sq[1] }; }
function slide(from, to) {
  const el = document.querySelector(`.sq[data-sq="${to}"] .pc`); if (!el) return;
  const a = sqXY(from), b = sqXY(to);
  el.animate([{ transform: `translate(${(a.f - b.f) * 100}%, ${(a.r - b.r) * 100}%)` }, { transform: 'translate(0,0)' }],
    { duration: 160, easing: 'cubic-bezier(.3,.1,.2,1)' });
}
function findKing(c) {
  const b = chess.board();
  for (let r = 0; r < 8; r++) for (let f = 0; f < 8; f++) { const p = b[r][f]; if (p && p.type === 'k' && p.color === c) return sqName(r, f); }
}
function renderArrows() {
  const svg = $('arrows');
  if (!hint) { svg.innerHTML = ''; return; }
  const a = sqXY(hint.from), b = sqXY(hint.to);
  const x1 = a.f + .5, y1 = a.r + .5, x2 = b.f + .5, y2 = b.r + .5;
  const dx = x2 - x1, dy = y2 - y1, len = Math.hypot(dx, dy), ux = dx / len, uy = dy / len;
  const hx = x2 - ux * .42, hy = y2 - uy * .42;  // arrow head base
  const px = -uy, py = ux, hw = .3;
  svg.innerHTML = `<g opacity=".88" fill="#2f8cff" stroke="none">
    <line x1="${x1}" y1="${y1}" x2="${hx}" y2="${hy}" stroke="#2f8cff" stroke-width=".2" stroke-linecap="round"/>
    <polygon points="${x2 - ux * .08},${y2 - uy * .08} ${hx + px * hw},${hy + py * hw} ${hx - px * hw},${hy - py * hw}"/></g>`;
}
function renderMoves() {
  const h = chess.history(); const el = $('moves');
  if (!h.length) { el.innerHTML = '<div class="empty">Moves will appear here</div>'; return; }
  let html = '';
  for (let i = 0; i < h.length; i += 2) {
    html += `<div class="n">${i / 2 + 1}.</div><div class="m${i === h.length - 1 ? ' cur' : ''}">${h[i]}</div><div class="m${i + 1 === h.length - 1 ? ' cur' : ''}">${h[i + 1] || ''}</div>`;
  }
  el.innerHTML = html; el.scrollTop = el.scrollHeight;
}
function renderStatus() {
  const el = $('status'); el.classList.remove('check');
  if (S.over) { el.textContent = `${S.result.title} (${S.result.score})`; return; }
  const c = chess.turn();
  el.textContent = `${nameOf(c)} to move${chess.inCheck() ? ' – check!' : ''}`;
  if (chess.inCheck()) el.classList.add('check');
}
function captured() {
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const now = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  let mat = { w: 0, b: 0 };
  for (const row of chess.board()) for (const p of row) if (p && p.type !== 'k') { now[p.color][p.type]++; mat[p.color] += VAL[p.type]; }
  const lost = { w: [], b: [] };
  for (const c of ['w', 'b']) for (const t of ['q', 'r', 'b', 'n', 'p']) for (let i = 0; i < Math.max(0, start[t] - now[c][t]); i++) lost[c].push(t);
  return { lost, mat };
}
const BULB = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a7 7 0 0 0-4 12.74V17a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1v-2.26A7 7 0 0 0 12 2zm-3 18h6v1a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-1z"/></svg>';
function renderCards() {
  const o = orient();
  const bottom = o.boardRot ? 'b' : 'w', top = bottom === 'w' ? 'b' : 'w';
  const { lost, mat } = captured();
  for (const [id, c] of [['cardTop', top], ['cardBottom', bottom]]) {
    const el = $(id); const opp = c === 'w' ? 'b' : 'w';
    const myTurn = !S.over && chess.turn() === c;
    const adv = mat[c] - mat[opp];
    const caps = lost[opp].map((t) => `<img src="pieces/${opp}${t.toUpperCase()}.svg" alt="">`).join('');
    const canHint = myTurn && S.hints[c] > 0 && !hintBusy && !hint;
    el.className = 'pcard' + (myTurn ? ' turn' : '') + (S.flipStyle === 'table' && S.autoFlip && c === 'b' && id === 'cardTop' ? ' rot' : '');
    el.innerHTML = `<div class="who"><div class="nm"><span class="dot ${c === 'w' ? 'white' : 'black'}"></span><span>${esc(nameOf(c))}</span>${myTurn ? '<span class="tomove">TO MOVE</span>' : ''}</div>
      <div class="caps">${caps}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div></div>
      <button class="hintbtn${hintBusy && myTurn ? ' busy' : ''}" data-c="${c}" ${canHint ? '' : 'disabled'} aria-label="Hint">${BULB}<span>${hintBusy && myTurn ? 'Thinking…' : 'Hint'}</span><span class="cnt">${S.hints[c]}</span></button>`;
    el.querySelector('.hintbtn').onclick = () => requestHint(c);
  }
}
const esc = (s) => s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));

/* ---------------- Eval bar ---------------- */
function evalPct(e) {
  if (!e) return 50;
  if (e.type === 'mate') return e.value > 0 ? 100 : e.value < 0 ? 0 : (chess.turn() === 'w' ? 0 : 100);
  const cp = Math.max(-1500, Math.min(1500, e.value));
  return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}
function evalLabel(e) {
  if (S.over) return S.result.score;
  if (!e) return '…';
  if (e.type === 'mate') return (e.value < 0 ? '-' : '') + 'M' + Math.abs(e.value);
  const v = e.value / 100;
  return (v > 0 ? '+' : '') + v.toFixed(Math.abs(v) >= 10 ? 0 : 1);
}
function renderEvalBar() {
  $('evalbar').classList.toggle('hidden', !S.evalOn);
  if (!S.evalOn) return;
  let pct = evalPct(lastEval);
  if (S.over) pct = chess.isCheckmate() ? (chess.turn() === 'w' ? 0 : 100) : 50;
  $('evalfill').style.height = pct.toFixed(1) + '%';
  renderEvalText();
}
function renderEvalText() {
  const t = $('evaltext'); if (!S) return;
  const pct = parseFloat($('evalfill').style.height) || 50;
  const whiteAhead = pct >= 50;
  t.textContent = evalLabel(lastEval);
  t.className = whiteAhead ? 'atW' : 'atB';
  // keep the number readable for whoever is to move in table mode
  if (orient().pieceRot) t.classList.add('flip');
}
function requestEval() {
  if (!S.evalOn || S.over) { renderEvalBar(); return; }
  const fen = chess.fen();
  evalJob = engine.analyze(fen, EVAL_LIMIT, (info) => {
    if (info.depth < 6 && lastEval) return;
    lastEval = info; window.__lastEval = { ...info, fen }; renderEvalBar();
  }, (best, info) => { window.__evalDone = { fen, best, info }; });
}

/* ---------------- Hints ---------------- */
function requestHint(c) {
  if (S.over || chess.turn() !== c || S.hints[c] <= 0 || hintBusy || hint) return;
  hintBusy = true; renderCards();
  const fen = chess.fen();
  engine.analyze(fen, HINT_LIMIT, (info) => {
    if (S.evalOn && info.depth >= 8) { lastEval = info; renderEvalBar(); }
  }, (best) => {
    hintBusy = false;
    if (chess.fen() !== fen || !best || best === '(none)') { renderCards(); return; }
    hint = { from: best.slice(0, 2), to: best.slice(2, 4), promo: best[4] };
    S.hints[c]--; save();
    window.__lastHint = { ...hint, fen, color: c };
    render();
  });
}

/* ---------------- Input: tap & drag ---------------- */
let press = null;
function squareAt(x, y) {
  const el = document.elementFromPoint(x, y);
  const sq = el && el.closest && el.closest('.sq');
  return sq && $('board').contains(sq) ? sq.dataset.sq : null;
}
function select(sq) {
  selected = sq; legalFromSel = sq ? chess.moves({ square: sq, verbose: true }) : [];
  renderBoard(); renderArrows();
}
function tryMove(from, to) {
  const cands = chess.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  if (!cands.length) return false;
  if (cands.some((m) => m.promotion)) { askPromotion(from, to); return true; }
  return doMove(from, to);
}
function onDown(e) {
  if (S.over || pendingPromo || hintBusy || !e.isPrimary) return;
  const sq = squareAt(e.clientX, e.clientY); if (!sq) return;
  const p = chess.get(sq);
  if (selected && sq !== selected && legalFromSel.some((m) => m.to === sq)) { tryMove(selected, sq); press = null; return; }
  if (p && p.color === chess.turn()) {
    const wasSel = selected === sq;
    if (!wasSel) select(sq);
    press = { sq, x: e.clientX, y: e.clientY, wasSel, drag: false, over: null };
    $('board').setPointerCapture(e.pointerId);
  } else { select(null); press = null; }
}
function onMove(e) {
  if (!press) return;
  if (!press.drag && Math.hypot(e.clientX - press.x, e.clientY - press.y) > 6) startDrag();
  if (press.drag) {
    moveGhost(e.clientX, e.clientY);
    const over = squareAt(e.clientX, e.clientY);
    if (over !== press.over) {
      document.querySelectorAll('.sq.over').forEach((el) => el.classList.remove('over'));
      if (over && legalFromSel.some((m) => m.to === over)) document.querySelector(`.sq[data-sq="${over}"]`).classList.add('over');
      press.over = over;
    }
  }
}
function startDrag() {
  press.drag = true;
  const pc = document.querySelector(`.sq[data-sq="${press.sq}"] .pc`); if (!pc) return;
  const size = pc.getBoundingClientRect().width;
  const g = $('ghost'); const o = orient();
  g.innerHTML = pc.innerHTML; g.style.width = g.style.height = size * 1.12 + 'px';
  g.dataset.rot = ((o.boardRot ? 180 : 0) + (o.pieceRot ? 180 : 0)) % 360;
  g.style.display = 'block'; pc.classList.add('dragging'); press.pc = pc; press.size = size * 1.12;
}
function moveGhost(x, y) {
  const g = $('ghost'), s = press.size;
  g.style.transform = `translate(${x - s / 2}px, ${y - s / 2}px) rotate(${g.dataset.rot % 360}deg)`;
}
function onUp(e) {
  if (!press) return;
  const p = press; press = null;
  $('ghost').style.display = 'none';
  document.querySelectorAll('.sq.over').forEach((el) => el.classList.remove('over'));
  if (p.drag) {
    const to = squareAt(e.clientX, e.clientY);
    if (p.pc) p.pc.classList.remove('dragging');
    if (to && to !== p.sq) { skipSlide = true; const ok = tryMove(p.sq, to); skipSlide = false; if (ok) return; }
  } else if (p.wasSel) select(null);
}
function onCancel() { if (press && press.pc) press.pc.classList.remove('dragging'); press = null; $('ghost').style.display = 'none'; }

/* ---------------- Promotion ---------------- */
function askPromotion(from, to) {
  pendingPromo = { from, to };
  const c = chess.turn(); const el = $('promo');
  el.innerHTML = `<div class="pbox${orient().pieceRot ? ' flip' : ''}">${['q', 'r', 'b', 'n'].map((t) =>
    `<button data-t="${t}" aria-label="${NAMES[t]}"><img src="pieces/${c}${t.toUpperCase()}.svg" alt=""></button>`).join('')}
    <button class="pcancel" data-t="x">Cancel</button></div>`;
  el.classList.remove('hidden');
  el.querySelectorAll('button').forEach((b) => (b.onclick = (ev) => {
    ev.stopPropagation();
    el.classList.add('hidden'); const pp = pendingPromo; pendingPromo = null;
    if (b.dataset.t === 'x') { select(null); return; }
    doMove(pp.from, pp.to, b.dataset.t);
  }));
}

/* ---------------- Dialogs ---------------- */
function modal(title, text, buttons) {
  $('mTitle').textContent = title; $('mText').textContent = text;
  const box = $('mBtns'); box.innerHTML = '';
  for (const b of buttons) {
    const el = document.createElement('button'); el.textContent = b.label; if (b.cls) el.className = b.cls;
    el.onclick = () => { $('modal').classList.add('hidden'); b.fn && b.fn(); };
    box.appendChild(el);
  }
  $('modal').classList.remove('hidden');
}
function showGameOver() {
  if (!S.over) return;
  modal(S.result.title, `${S.result.text}  Result: ${S.result.score}`, [
    { label: 'Look at board' }, { label: 'Undo last move', fn: undo },
    { label: 'New game', cls: 'primary', fn: showSetup }]);
}
function undo() {
  if (!S.moves.length) return;
  engine.cancel(); hintBusy = false;
  chess.undo(); S.moves.pop(); lastEval = null;
  afterPositionChange(true);
}

/* ---------------- Wire up ---------------- */
function bind() {
  const b = $('board');
  b.addEventListener('pointerdown', onDown);
  b.addEventListener('pointermove', onMove);
  b.addEventListener('pointerup', onUp);
  b.addEventListener('pointercancel', onCancel);
  b.addEventListener('contextmenu', (e) => e.preventDefault());
  $('undoBtn').onclick = () => modal('Undo last move?', 'This takes back the last move played. Used hints are not refunded.', [
    { label: 'Cancel' }, { label: 'Undo', cls: 'danger', fn: undo }]);
  $('newBtn').onclick = () => modal('Start a new game?', 'The current game will be lost.', [
    { label: 'Cancel' }, { label: 'New game', cls: 'danger', fn: () => { S.moves = []; S.over = false; save(); showSetup(); } }]);
  $('gEval').onchange = (e) => {
    S.evalOn = e.target.checked; save(); layout();
    if (S.evalOn) { lastEval = null; requestEval(); } else if (!hintBusy) engine.cancel();
    renderEvalBar();
  };
  $('gFlip').onchange = (e) => { S.autoFlip = e.target.checked; save(); applyOrientation(); renderCards(); };
  document.addEventListener('gesturestart', (e) => e.preventDefault());
}
bind();
const saved = load();
if (saved && saved.moves && saved.moves.length && !saved.over) startGame(saved); else initSetup();

// test hooks
window.__app = { get chess() { return chess; }, get S() { return S; }, doMove, requestHint, undo, get hint() { return hint; } };
