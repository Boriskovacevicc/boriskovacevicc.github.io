import { Chess } from './vendor/chess.js';
import { suggestBalance, buildOddsFen, PIECE_CHOICES } from './balance.js';
import { PIECE_STYLES, validStyle, pieceFile } from './piecesets.js';
import { makeClock, applyElapsed, afterMove, pauseClock, resumeClock, arm, formatClock, flagResult, canForceMate } from './clock.js';
import { setColourChoice, resolveColours, coloursForGame, freshSeries, addSeriesGame, undoSeriesGame, removalsForGame, hintsForGame, namesForGame, stylesForGame, playerKey } from './series.js';
import { listPlayers, rememberPlayer, recordChessResult, removeChessResult, saveChessSeries, nameKey, peekPlayers } from '../shared/store.js';

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
  startFen: null, oddsLabel: '', resultId: null,
  styles: { w: 'cburnett', b: 'cburnett' }, clock: null, series: null, seriesEntry: null, clockStack: [],
});
function save() { try { localStorage.setItem(STORE, JSON.stringify(S)); } catch (e) {} }
function load() { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } }
const nameOf = (c) => (S.names[c] || (c === 'w' ? 'White' : 'Black'));

/* ---------------- Setup screen ---------------- */
let directory = [];
let balanceMode = 'hints';
let removed = [];
let removedBySeat = { W: [], B: [] };
let oddsManual = false;
let focusColor = 'W';
let colourPick = { W: 'w', B: 'b' };
let stylePick = { W: 'cburnett', B: 'cburnett' };
let styleSeat = 'W';
let activeSeries = null;
let clockTimer = 0;
let clockMark = 0;
const BASE_STEPS = [0, 1, 3, 5, 10, 15, 30, 60, 90, 120];

function updHints() {
  $('hintsWVal').textContent = $('hintsW').value;
  $('hintsBVal').textContent = $('hintsB').value;
}
function readRate(color) {
  const n = Number($('rate' + color).value);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 0;
}
function ratingFor(name) {
  const found = directory.find((p) => p && p.nameKey === nameKey(name));
  return found && found.chesscom ? String(found.chesscom) : '';
}
function profileFor(seat) {
  return directory.find((p) => p && p.nameKey === nameKey($('name' + seat).value));
}
function fillDirectory() {
  const list = $('boki-players');
  list.replaceChildren();
  directory.forEach((player) => {
    const option = document.createElement('option');
    option.value = player.name;
    list.appendChild(option);
  });
  const known = $('known');
  known.replaceChildren();
  directory.forEach((player) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = player.name;
    btn.onclick = () => {
      const input = $('name' + focusColor);
      input.value = player.name;
      const rate = $('rate' + focusColor);
      if (!rate.dataset.dirty) rate.value = player.chesscom ? String(player.chesscom) : '';
      updateBalance();
    };
    known.appendChild(btn);
  });
  known.classList.toggle('hidden', directory.length === 0);
}
function previewColours() {
  return resolveColours(colourPick, 0);
}
function removalsNow() {
  const colours = previewColours();
  return ['W', 'B'].flatMap((seat) => (removedBySeat[seat] || []).map((id) => ({ color: colours[seat], id })));
}
function renderOdds() {
  removed = removalsNow();
  const colours = previewColours();
  const box = $('oddsPick');
  box.replaceChildren();
  for (const seat of ['W', 'B']) {
    const color = colours[seat];
    const who = $('name' + seat).value.trim() || (seat === 'W' ? 'Player 1' : 'Player 2');
    const side = document.createElement('div');
    side.className = 'odds-side';
    const title = document.createElement('h3');
    title.textContent = who;
    const pieces = document.createElement('div');
    pieces.className = 'odds-pieces';
    PIECE_CHOICES.forEach((choice) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      const off = (removedBySeat[seat] || []).includes(choice.id);
      btn.classList.toggle('off', off);
      btn.setAttribute('aria-pressed', off ? 'true' : 'false');
      btn.setAttribute('aria-label', (off ? 'Put back ' : 'Remove ') + who + ' ' + choice.word);
      const img = document.createElement('img');
      img.src = pieceFile(stylePick[seat], color, choice.glyph);
      img.alt = '';
      btn.appendChild(img);
      btn.onclick = () => {
        oddsManual = true;
        const ids = new Set(removedBySeat[seat] || []);
        if (ids.has(choice.id)) ids.delete(choice.id); else ids.add(choice.id);
        removedBySeat = { ...removedBySeat, [seat]: [...ids] };
        renderOdds();
      };
      pieces.appendChild(btn);
    });
    side.append(title, pieces);
    box.appendChild(side);
  }
  const built = buildOddsFen(removed);
  $('oddsLive').textContent = built.label;
}
function markMode() {
  $('balanceMode').querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', btn.dataset.mode === balanceMode));
}
function updateBalance() {
  const white = readRate('W');
  const black = readRate('B');
  if (!white || !black) {
    $('balance').classList.add('hidden');
    renderOdds();
    return;
  }
  $('balance').classList.remove('hidden');
  const suggestion = suggestBalance({
    whiteName: $('nameW').value, blackName: $('nameB').value,
    whiteRating: white, blackRating: black, mode: balanceMode,
  });
  $('balanceLine').textContent = suggestion.line;
  markMode();
  if (!oddsManual) {
    const strongerSeat = white >= black ? 'W' : 'B';
    const ids = balanceMode === 'hints' ? [] : suggestion.removed.map((item) => item.id);
    removedBySeat = { W: [], B: [], [strongerSeat]: ids };
  }
  if (suggestion.hints.w != null) {
    $('hintsW').value = String(suggestion.hints.w);
    $('hintsB').value = String(suggestion.hints.b);
    updHints();
  }
  renderOdds();
}
function onNameInput(color) {
  focusColor = color;
  const rate = $('rate' + color);
  if (!rate.dataset.dirty) rate.value = ratingFor($('name' + color).value);
  const found = profileFor(color);
  if (found && found.pieceStyle && !$('styleBtn' + color).dataset.dirty) {
    stylePick[color] = validStyle(found.pieceStyle);
    paintStyles();
  }
  updateBalance();
}
async function rememberSetupNames() {
  const tasks = [];
  for (const color of ['W', 'B']) {
    const name = $('name' + color).value.trim();
    if (!name) continue;
    tasks.push(rememberPlayer(name, { chesscom: readRate(color) || null, pieceStyle: stylePick[color] }));
  }
  if (!tasks.length) return;
  directory = [];
  await Promise.all(tasks);
  try { directory = await listPlayers(); } catch (e) { directory = []; }
  fillDirectory();
}
function initSetup() {
  const saved = load();
  const prev = saved || defaults();
  balanceMode = 'hints';
  oddsManual = false;
  removedBySeat = { W: [], B: [] };
  removed = [];
  activeSeries = null;
  $('nameW').value = prev.names?.w || ''; $('nameB').value = prev.names?.b || '';
  $('rateW').value = ''; $('rateB').value = '';
  $('rateW').dataset.dirty = ''; $('rateB').dataset.dirty = '';
  $('rateW').value = ratingFor($('nameW').value);
  $('rateB').value = ratingFor($('nameB').value);
  $('hintsW').value = prev.hintsStart?.w ?? 3; $('hintsB').value = prev.hintsStart?.b ?? 3;
  $('optEval').checked = !!prev.evalOn;  // default OFF
  $('optFlip').checked = prev.autoFlip !== false;
  setFlipStyle(prev.flipStyle || 'table');
  $('hintsW').oninput = updHints; $('hintsB').oninput = updHints; updHints();
  $('flipStyle').querySelectorAll('button').forEach((b) => (b.onclick = () => setFlipStyle(b.dataset.v)));
  $('resumeBtn').classList.toggle('hidden', !(saved && saved.moves && saved.moves.length && !saved.over));
  $('resumeBtn').onclick = () => startGame(saved);
  $('startBtn').onclick = () => {
    rememberSetupNames();
    const colours = resolveColours(colourPick, Math.random());
    const target = Number($('seriesTarget').value) || 0;
    const session = target >= 1 ? freshSeries({
      target,
      nameW: $('nameW').value.trim(),
      nameB: $('nameB').value.trim(),
      firstColours: { W: colours.W, B: colours.B },
      hints: { W: +$('hintsW').value, B: +$('hintsB').value },
      removedBySeat,
      styles: { ...stylePick },
      control: readControl(),
    }) : null;
    activeSeries = session;
    const st = stateForGame(session, colours, 0);
    st.reveal = colours.random ? `${st.names.w || 'White'} plays White. ${st.names.b || 'Black'} plays Black.` : '';
    startGame(st);
    if (st.reveal) showReveal(st.reveal);
  };
  updateBalance();
}
function setFlipStyle(v) {
  $('flipStyle').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.v === v));
  $('flipStyleHelp').textContent = v === 'table'
    ? 'Sitting across a table: the pieces turn to face whoever is to move'
    : 'Handing the iPad over: the whole board turns round';
}
function showSetup() { stopTicker(); engine.cancel(); $('game').classList.add('hidden'); $('setup').classList.remove('hidden'); initSetup(); }

/* ---------------- Game lifecycle ---------------- */
function readControl() {
  return {
    baseMin: Number($('baseTime').dataset.min || 0),
    incSec: Number($('incTime').value) || 0,
    advanced: $('advClock').checked,
    phaseMove: Number($('phaseMove').value) || 40,
    phaseBonusMin: Number($('phaseBonus').value) || 0,
    phaseIncSec: Number($('phaseInc').value) || 0,
  };
}
function stateForGame(series, colours, gameIndex) {
  const st = defaults();
  const use = series ? coloursForGame(series.firstColours, gameIndex) : colours;
  const pack = series || {
    nameW: $('nameW').value.trim(), nameB: $('nameB').value.trim(),
    hints: { W: +$('hintsW').value, B: +$('hintsB').value },
    removedBySeat, styles: { ...stylePick }, control: readControl(),
  };
  st.names = namesForGame(pack, use);
  st.hintsStart = hintsForGame(pack, use);
  st.hints = { ...st.hintsStart };
  st.styles = stylesForGame(pack, use);
  st.evalOn = $('optEval').checked;
  st.autoFlip = $('optFlip').checked;
  st.flipStyle = $('flipStyle').querySelector('.on').dataset.v;
  const gone = removalsForGame(pack, use);
  if (gone.length) {
    const built = buildOddsFen(gone);
    st.startFen = built.fen;
    st.oddsLabel = built.label;
  }
  st.clock = makeClock(pack.control);
  if (st.clock) st.clock = arm(st.clock, 'w');
  st.series = series;
  st.seriesGame = gameIndex;
  st.colourNote = use;
  return st;
}
function startGame(st) {
  stopTicker();
  S = Object.assign(defaults(), st);
  try { chess = S.startFen ? new Chess(S.startFen) : new Chess(); }
  catch (e) { chess = new Chess(); S.startFen = null; S.oddsLabel = ''; }
  for (const m of S.moves) { try { chess.move(m); } catch (e) { break; } }
  S.moves = chess.history({ verbose: true }).map((m) => ({ from: m.from, to: m.to, promotion: m.promotion }));
  selected = null; hint = null; hintBusy = false; lastEval = null; animateFrom = null;
  shownTurn = chess.turn();
  engine.newGame();
  if (S.evalOn || S.hints.w + S.hints.b > 0) engine.start();
  $('setup').classList.add('hidden'); $('game').classList.remove('hidden');
  $('gEval').checked = S.evalOn; $('gFlip').checked = S.autoFlip;
  if (S.clock && !S.over) S.clock = { ...S.clock, running: !S.clock.paused && !S.clock.flagged, active: S.clock.active || chess.turn() };
  layout(); applyOrientation(true); render(); save();
  afterPositionChange(false);
  startTicker();
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
  if (S.clock && clockMark) S.clock = applyElapsed(S.clock, performance.now() - clockMark);
  if (S.clock) S.clockStack = (S.clockStack || []).concat([S.clock]);
  S.moves.push({ from: mv.from, to: mv.to, promotion: mv.promotion });
  if (S.clock) S.clock = afterMove(S.clock, mv.color, S.moves.length);
  animateFrom = skipSlide ? {} : { from: mv.from, to: mv.to };
  if (mv.flags.includes('k')) animateFrom.rook = mv.color === 'w' ? ['h1', 'f1'] : ['h8', 'f8'];
  if (mv.flags.includes('q')) animateFrom.rook = mv.color === 'w' ? ['a1', 'd1'] : ['a8', 'd8'];
  afterPositionChange(true);
  startTicker();
  if (S.over) setTimeout(showGameOver, 650);
  return true;
}

function checkGameOver() {
  if (S.clock && S.clock.flagged && !chess.isGameOver()) {
    const opp = S.clock.flagged === 'w' ? 'b' : 'w';
    const types = [];
    for (const row of chess.board()) for (const p of row) if (p && p.color === opp) types.push(p.type);
    const outcome = flagResult(S.clock.flagged, canForceMate(types));
    S.over = true;
    const winner = outcome.winner;
    S.result = outcome.kind === 'draw'
      ? { score: '½-½', title: 'Draw by time', text: `${nameOf(S.clock.flagged)} ran out of time, and ${nameOf(opp)} does not have enough material to mate.` }
      : { score: outcome.score, title: `${nameOf(winner)} wins on time`, text: `${nameOf(S.clock.flagged)} ran out of time.` };
    commitResult();
    return;
  }
  S.over = chess.isGameOver();
  if (!S.over) {
    if (S.resultId) {
      const id = S.resultId;
      const snapshot = S.seriesEntry;
      S.resultId = null;
      S.seriesEntry = null;
      if (S.series && snapshot) {
        S.series = undoSeriesGame(S.series, snapshot);
        activeSeries = S.series;
        saveChessSeries(S.series).catch(() => {});
      }
      removeChessResult(id).catch(() => {});
    }
    S.result = null;
    return;
  }
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
  commitResult();
}
function commitResult() {
  if (!S.result || S.resultId) return;
  stopTicker();
  S.resultId = 'cg_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const draw = S.result.score === '½-½';
  const white = S.names.w || 'White';
  const black = S.names.b || 'Black';
  const game = {
    id: S.resultId,
    date: new Date().toISOString(),
    white, black,
    result: draw ? '1/2-1/2' : S.result.score,
    winner: draw ? null : (S.result.score === '1-0' ? white : black),
    loser: draw ? null : (S.result.score === '1-0' ? black : white),
    seriesId: S.series ? S.series.id : null,
  };
  recordChessResult(game).catch(() => {});
  if (S.series && !S.seriesEntry) {
    S.seriesEntry = { id: game.id, result: game.result, whiteKey: playerKey(white, 'player-1'), blackKey: playerKey(black, 'player-2') };
    S.series = addSeriesGame(S.series, S.seriesEntry);
    activeSeries = S.series;
    saveChessSeries(S.series).catch(() => {});
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
  const note = $('oddsNote');
  if (note) {
    note.textContent = S && S.oddsLabel ? S.oddsLabel : '';
    note.classList.toggle('hidden', !(S && S.oddsLabel));
  }
  $('undoBtn').disabled = S.moves.length === 0;
  const pause = $('pauseBtn');
  if (pause) {
    const on = !!(S && S.clock);
    pause.classList.toggle('hidden', !on);
    pause.textContent = S && S.clock && S.clock.paused ? 'Resume' : 'Pause';
    pause.disabled = !!(S && S.clock && (S.clock.flagged || S.over));
  }
  const banner = $('seriesBanner');
  if (banner) {
    if (S && S.series) {
      banner.hidden = false;
      banner.classList.remove('hidden');
      banner.textContent = `${S.series.nameW} ${S.series.scores[S.series.keyW]} – ${S.series.scores[S.series.keyB]} ${S.series.nameB} · first to ${S.series.target}`;
    } else banner.classList.add('hidden');
  }
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
    if (p) html += `<div class="pc" data-p="${p.color}${p.type}"><img src="${pieceFile(S.styles && S.styles[p.color], p.color, p.type)}" alt="${p.color === 'w' ? 'white' : 'black'} ${NAMES[p.type]}" draggable="false"></div>`;
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
    const caps = lost[opp].map((t) => `<img src="${pieceFile(S.styles && S.styles[opp], opp, t)}" alt="">`).join('');
    const clk = S.clock ? `<div class="clk${S.clock.flagged === c ? ' flag' : ''}${S.clock.remaining[c] <= 20000 ? ' low' : ''}${S.clock.active === c && S.clock.running && !S.clock.paused ? ' run' : ''}">${formatClock(S.clock.remaining[c])}</div>` : '';
    const canHint = myTurn && S.hints[c] > 0 && !hintBusy && !hint;
    el.className = 'pcard' + (myTurn ? ' turn' : '') + (S.flipStyle === 'table' && S.autoFlip && c === 'b' && id === 'cardTop' ? ' rot' : '');
    el.innerHTML = `<div class="who"><div class="nm"><span class="dot ${c === 'w' ? 'white' : 'black'}"></span><span>${esc(nameOf(c))}</span>${myTurn ? '<span class="tomove">TO MOVE</span>' : ''}</div>
      <div class="caps">${caps}${adv > 0 ? `<span class="adv">+${adv}</span>` : ''}</div></div>
      ${clk}
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
    `<button data-t="${t}" aria-label="${NAMES[t]}"><img src="${pieceFile(S.styles && S.styles[c], c, t)}" alt=""></button>`).join('')}
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
  if (!S.over || !S.result) return;
  stopTicker();
  const buttons = [{ label: 'Look at board' }, { label: 'Undo last move', fn: undo }];
  if (S.series && S.series.finished) {
    const who = S.series.winnerKey === S.series.keyW ? S.series.nameW : S.series.nameB;
    const title = S.series.drawn ? 'The series is a draw' : `${who} wins the series`;
    const line = `${S.series.nameW} ${S.series.scores[S.series.keyW]} – ${S.series.scores[S.series.keyB]} ${S.series.nameB}. ${S.result.text}`;
    modal(title, line, buttons.concat([{ label: 'New series', cls: 'primary', fn: showSetup }]));
    return;
  }
  if (S.series) buttons.push({ label: 'Next game', cls: 'primary', fn: nextSeriesGame });
  else buttons.push({ label: 'New game', cls: 'primary', fn: showSetup });
  modal(S.result.title, `${S.result.text}  Result: ${S.result.score}`, buttons);
}
function nextSeriesGame() {
  const series = S.series;
  const st = stateForGame(series, series.firstColours, series.games.length);
  const reveal = `${st.names.w || 'White'} has White. ${st.names.b || 'Black'} has Black.`;
  startGame(st);
  if (S.clock) S.clock = pauseClock(S.clock);
  stopTicker();
  modal('Next game', reveal, [{ label: "Let's play", cls: 'primary', fn: () => { if (S.clock) { S.clock = resumeClock(S.clock); startTicker(); render(); } } }]);
}
function showReveal(text) {
  if (S.clock) S.clock = pauseClock(S.clock);
  stopTicker();
  modal('Colours', text, [{ label: "Let's play", cls: 'primary', fn: () => { if (S.clock) { S.clock = resumeClock(S.clock); startTicker(); render(); } } }]);
}
function undo() {
  if (!S.moves.length) return;
  engine.cancel(); hintBusy = false;
  chess.undo(); S.moves.pop(); lastEval = null;
  if (S.clockStack && S.clockStack.length) S.clock = S.clockStack.pop();
  afterPositionChange(true);
  startTicker();
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
function wireSetup() {
  for (const color of ['W', 'B']) {
    $('name' + color).addEventListener('focus', () => { focusColor = color; });
    $('name' + color).addEventListener('input', () => onNameInput(color));
    $('name' + color).addEventListener('change', () => rememberSetupNames());
    $('rate' + color).addEventListener('input', () => {
      $('rate' + color).dataset.dirty = '1';
      oddsManual = false;
      updateBalance();
    });
  }
  $('balanceMode').querySelectorAll('button').forEach((btn) => {
    btn.addEventListener('click', () => {
      balanceMode = btn.dataset.mode;
      oddsManual = false;
      updateBalance();
    });
  });
  for (const seat of ['W', 'B']) {
    $('color' + seat).querySelectorAll('button').forEach((btn) => {
      btn.addEventListener('click', () => {
        colourPick = setColourChoice(colourPick, seat, btn.dataset.v);
        paintColours();
        renderOdds();
      });
    });
    $('styleBtn' + seat).addEventListener('click', () => openStyles(seat));
  }
  $('styleClose').addEventListener('click', () => $('stylePop').classList.add('hidden'));
  $('stylePop').addEventListener('click', (e) => { if (e.target === $('stylePop')) $('stylePop').classList.add('hidden'); });
  $('baseTime').addEventListener('input', () => setBase(BASE_STEPS[+$('baseTime').value]));
  $('baseMinus').addEventListener('click', () => setBase((Number($('baseTime').dataset.min) || 0) - 1));
  $('basePlus').addEventListener('click', () => setBase((Number($('baseTime').dataset.min) || 0) + 1));
  $('incTime').addEventListener('input', paintClock);
  $('advClock').addEventListener('change', () => { $('phase2').classList.toggle('hidden', !$('advClock').checked); paintClock(); });
  $('phaseMove').addEventListener('input', paintClock);
  $('phaseBonus').addEventListener('input', paintClock);
  $('phaseInc').addEventListener('input', paintClock);
  $('seriesTarget').addEventListener('input', paintSeries);
  $('pauseBtn').addEventListener('click', togglePause);
  document.addEventListener('visibilitychange', onHide);
  setBase(0);
  paintClock();
  paintSeries();
  paintColours();
  paintStyles();
}
function paintColours() {
  for (const seat of ['W', 'B']) {
    $('color' + seat).querySelectorAll('button').forEach((btn) => btn.classList.toggle('on', btn.dataset.v === colourPick[seat]));
    const dot = $('dot' + seat);
    dot.className = 'dot' + (colourPick[seat] === 'b' ? ' black' : colourPick[seat] === 'r' ? ' rand' : ' white');
  }
}
function paintStyles() {
  $('stylePrevW').src = pieceFile(stylePick.W, 'w', 'n');
  $('stylePrevB').src = pieceFile(stylePick.B, 'b', 'n');
}
function openStyles(seat) {
  styleSeat = seat;
  $('styleBtn' + seat).dataset.dirty = '1';
  const grid = $('styleGrid');
  grid.replaceChildren();
  const who = $('name' + seat).value.trim() || (seat === 'W' ? 'Player 1' : 'Player 2');
  $('stylePopTitle').textContent = who + '’s pieces';
  PIECE_STYLES.forEach((style) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'style-opt' + (stylePick[seat] === style.id ? ' on' : '');
    const name = document.createElement('span');
    name.textContent = style.name;
    const row = document.createElement('span');
    row.className = 'preview';
    for (const type of ['k', 'q', 'n', 'p']) {
      const img = document.createElement('img');
      img.src = pieceFile(style.id, 'w', type);
      img.alt = '';
      row.appendChild(img);
    }
    btn.append(name, row);
    btn.addEventListener('click', () => {
      stylePick[seat] = style.id;
      paintStyles();
      renderOdds();
      const typed = $('name' + seat).value.trim();
      if (typed) rememberPlayer(typed, { pieceStyle: style.id }).catch(() => {});
      openStyles(seat);
    });
    grid.appendChild(btn);
  });
  $('stylePop').classList.remove('hidden');
}
function setBase(min) {
  const next = Math.max(0, Math.min(120, Math.round(min)));
  $('baseTime').dataset.min = String(next);
  let best = 0;
  let dist = 999;
  BASE_STEPS.forEach((step, i) => { const d = Math.abs(step - next); if (d < dist) { dist = d; best = i; } });
  $('baseTime').value = String(best);
  paintClock();
}
function paintClock() {
  const min = Number($('baseTime').dataset.min || 0);
  $('baseVal').textContent = min ? min + ' min' : 'Off';
  $('incVal').textContent = $('incTime').value + 's';
  $('phaseMoveVal').textContent = $('phaseMove').value;
  $('phaseBonusVal').textContent = $('phaseBonus').value;
  $('phaseIncVal').textContent = $('phaseInc').value + 's';
  const inc = $('incTime').value;
  $('clockSummary').textContent = min ? `${min} min + ${inc}s` + ($('advClock').checked ? ' · two phases' : '') : 'No clock';
}
function paintSeries() {
  const n = Number($('seriesTarget').value);
  $('seriesVal').textContent = n ? String(n) : 'Off';
}
function togglePause() {
  if (!S || !S.clock || S.over) return;
  if (S.clock.paused) {
    S.clock = resumeClock(S.clock);
    startTicker();
  } else {
    if (clockMark) S.clock = applyElapsed(S.clock, performance.now() - clockMark);
    S.clock = pauseClock(S.clock);
    stopTicker();
  }
  render();
  save();
}
function startTicker() {
  stopTicker();
  if (!S || !S.clock || S.over || S.clock.paused || S.clock.flagged || document.hidden) return;
  clockMark = performance.now();
  clockTimer = setInterval(() => {
    const now = performance.now();
    S.clock = applyElapsed(S.clock, now - clockMark);
    clockMark = now;
    if (S.clock.flagged) {
      stopTicker();
      checkGameOver();
      render();
      save();
      showGameOver();
      return;
    }
    render();
  }, 250);
}
function stopTicker() {
  if (clockTimer) clearInterval(clockTimer);
  clockTimer = 0;
  clockMark = 0;
}
function onHide() {
  if (!S || !S.clock) return;
  if (document.hidden) {
    if (clockMark) S.clock = applyElapsed(S.clock, performance.now() - clockMark);
    stopTicker();
    save();
  } else startTicker();
}
wireSetup();
async function boot() {
  directory = peekPlayers();
  fillDirectory();
  const saved = load();
  if (saved && saved.moves && saved.moves.length && !saved.over) startGame(saved);
  else initSetup();
  try {
    directory = await listPlayers();
    fillDirectory();
    if (!$('setup').classList.contains('hidden')) {
      if (!$('rateW').dataset.dirty && !$('rateW').value) $('rateW').value = ratingFor($('nameW').value);
      if (!$('rateB').dataset.dirty && !$('rateB').value) $('rateB').value = ratingFor($('nameB').value);
      updateBalance();
    }
  } catch (e) { /* names already work from this device */ }
}
boot();

// test hooks
window.__app = { get chess() { return chess; }, get S() { return S; }, doMove, requestHint, undo, get hint() { return hint; } };
