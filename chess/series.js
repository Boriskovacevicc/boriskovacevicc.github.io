import { nameKey, normaliseName } from "../shared/store.js";

export function setColourChoice(current, seat, value) {
  const next = { ...current, [seat]: value };
  const other = seat === "W" ? "B" : "W";
  if (value === "w") next[other] = "b";
  else if (value === "b") next[other] = "w";
  return next;
}

/** pick is { W, B } with 'w' | 'b' | 'r'. rand in [0, 1). */
export function resolveColours(pick, rand = 0) {
  const W = pick.W;
  const B = pick.B;
  if (W === "w" || B === "b") return { W: "w", B: "b", random: W === "r" || B === "r" };
  if (W === "b" || B === "w") return { W: "b", B: "w", random: W === "r" || B === "r" };
  const whiteSeat = rand < 0.5 ? "W" : "B";
  return whiteSeat === "W"
    ? { W: "w", B: "b", random: true }
    : { W: "b", B: "w", random: true };
}

/** gameIndex is 0 for the first game. */
export function coloursForGame(first, gameIndex) {
  if (gameIndex % 2 === 0) return { W: first.W, B: first.B };
  return {
    W: first.W === "w" ? "b" : "w",
    B: first.B === "w" ? "b" : "w",
  };
}

export function pointsFor(result, color) {
  if (result === "1/2-1/2") return 0.5;
  if (color === "w") return result === "1-0" ? 1 : 0;
  return result === "0-1" ? 1 : 0;
}

function half(n) {
  return Math.round((Number(n) || 0) * 2) / 2;
}

export function playerKey(name, fallback) {
  return nameKey(name) || fallback;
}

export function freshSeries({ target, nameW, nameB, firstColours, hints, removedBySeat, styles, control }) {
  const keyW = playerKey(nameW, "player-1");
  const keyB = playerKey(nameB, "player-2");
  return {
    id: "cs_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    target,
    nameW: normaliseName(nameW) || "Player 1",
    nameB: normaliseName(nameB) || "Player 2",
    keyW,
    keyB,
    firstColours,
    hints: { W: hints.W, B: hints.B },
    removedBySeat: { W: (removedBySeat.W || []).slice(), B: (removedBySeat.B || []).slice() },
    styles: { W: styles.W, B: styles.B },
    control: control || null,
    scores: { [keyW]: 0, [keyB]: 0 },
    games: [],
    finished: false,
    drawn: false,
    winnerKey: null,
    updatedAt: Date.now(),
  };
}

export function addSeriesGame(series, entry) {
  const scores = { ...series.scores };
  scores[entry.whiteKey] = half((scores[entry.whiteKey] || 0) + pointsFor(entry.result, "w"));
  scores[entry.blackKey] = half((scores[entry.blackKey] || 0) + pointsFor(entry.result, "b"));
  const a = scores[series.keyW];
  const b = scores[series.keyB];
  const hitA = a >= series.target;
  const hitB = b >= series.target;
  let finished = false;
  let drawn = false;
  let winnerKey = null;
  if (hitA || hitB) {
    finished = true;
    if (hitA && hitB) drawn = true;
    else winnerKey = hitA ? series.keyW : series.keyB;
  }
  return {
    ...series,
    scores,
    games: series.games.concat([entry.id]),
    finished,
    drawn,
    winnerKey,
    updatedAt: Date.now(),
  };
}

export function undoSeriesGame(series, entry) {
  if (!series.games.length || series.games[series.games.length - 1] !== entry.id) return series;
  const scores = { ...series.scores };
  scores[entry.whiteKey] = half((scores[entry.whiteKey] || 0) - pointsFor(entry.result, "w"));
  scores[entry.blackKey] = half((scores[entry.blackKey] || 0) - pointsFor(entry.result, "b"));
  return {
    ...series,
    scores,
    games: series.games.slice(0, -1),
    finished: false,
    drawn: false,
    winnerKey: null,
    updatedAt: Date.now(),
  };
}

/** Piece ids taken off a player follow that player when the colours swap. */
export function removalsForGame(series, colours) {
  const out = [];
  for (const seat of ["W", "B"]) {
    const ids = (series.removedBySeat && series.removedBySeat[seat]) || [];
    for (const id of ids) out.push({ color: colours[seat], id });
  }
  return out;
}

export function hintsForGame(series, colours) {
  return {
    [colours.W]: series.hints.W,
    [colours.B]: series.hints.B,
  };
}

export function namesForGame(series, colours) {
  return {
    [colours.W]: series.nameW,
    [colours.B]: series.nameB,
  };
}

export function stylesForGame(series, colours) {
  return {
    [colours.W]: series.styles.W,
    [colours.B]: series.styles.B,
  };
}
