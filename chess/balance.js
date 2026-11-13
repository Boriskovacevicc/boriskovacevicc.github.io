/**
 * Chess auto-balance. One table for piece odds, one rule for hints.
 * Gaps are the difference between the two chess.com ratings.
 *
 * Piece odds (removed from the stronger player), inclusive bounds:
 *   under 100            nothing
 *   100–199              f-pawn
 *   200–349              queen's knight
 *   350–499              queen's rook
 *   500–699              queen
 *   700–999              queen and queen's knight
 *   1000–1399            queen and queen's rook
 *   1400–1799            queen's rook, queen's knight and f-pawn
 *   1800 and up          queen, queen's rook, queen's knight and f-pawn
 *
 * Hints ("Hints only"):
 *   under 75             both players get 2
 *   otherwise            weaker = clamp(round(gap / 100) + 1, 1, 30)
 *                        stronger = 2 if gap < 600, 1 if gap < 1200, else 0
 * "Both" uses the piece table and halves the weaker player's hints (minimum 1).
 * An even game (gap under 75) is not halved.
 */

export const HINT_MAX = 30;

export const PIECE_LADDER = [
  { below: 100, pieces: [] },
  { below: 200, pieces: ["f-pawn"] },
  { below: 350, pieces: ["knight"] },
  { below: 500, pieces: ["rook"] },
  { below: 700, pieces: ["queen"] },
  { below: 1000, pieces: ["queen", "knight"] },
  { below: 1400, pieces: ["queen", "rook"] },
  { below: 1800, pieces: ["rook", "knight", "f-pawn"] },
  { below: Infinity, pieces: ["queen", "rook", "knight", "f-pawn"] },
];

export const PIECE_CHOICES = [
  { id: "f-pawn", word: "f-pawn", glyph: "P" },
  { id: "knight", word: "queen's knight", glyph: "N" },
  { id: "knight-k", word: "king's knight", glyph: "N" },
  { id: "rook", word: "queen's rook", glyph: "R" },
  { id: "rook-k", word: "king's rook", glyph: "R" },
  { id: "queen", word: "queen", glyph: "Q" },
];

const SQUARES = {
  w: { "f-pawn": "f2", knight: "b1", "knight-k": "g1", rook: "a1", "rook-k": "h1", queen: "d1" },
  b: { "f-pawn": "f7", knight: "b8", "knight-k": "g8", rook: "a8", "rook-k": "h8", queen: "d8" },
};

const WORDS = Object.fromEntries(PIECE_CHOICES.map((p) => [p.id, p.word]));

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function piecesForGap(gap) {
  const g = Math.max(0, Number(gap) || 0);
  for (const row of PIECE_LADDER) {
    if (g < row.below) return row.pieces.slice();
  }
  return [];
}

export function hintPlan(gap) {
  const g = Math.max(0, Number(gap) || 0);
  if (g < 75) return { gap: g, weaker: 2, stronger: 2, even: true };
  return {
    gap: g,
    weaker: clamp(Math.round(g / 100) + 1, 1, HINT_MAX),
    stronger: g < 600 ? 2 : g < 1200 ? 1 : 0,
    even: false,
  };
}

function displayName(name, fallback) {
  const clean = String(name || "").trim();
  return clean || fallback;
}

function listWords(ids) {
  const words = ids.map((id) => WORDS[id] || id);
  if (words.length <= 1) return words[0] || "nothing";
  return words.slice(0, -1).join(", ") + " and " + words[words.length - 1];
}

export function describeRemoved(removed) {
  if (!removed || !removed.length) return "";
  const groups = { w: [], b: [] };
  for (const item of removed) if (groups[item.color]) groups[item.color].push(item.id);
  const bits = [];
  if (groups.w.length) bits.push("White gives up " + listWords(groups.w));
  if (groups.b.length) bits.push("Black gives up " + listWords(groups.b));
  return bits.join("; ");
}

/**
 * @param {{whiteName?: string, blackName?: string, whiteRating: number, blackRating: number, mode: "hints"|"pieces"|"both"}} input
 */
export function suggestBalance(input) {
  const whiteRating = Number(input.whiteRating);
  const blackRating = Number(input.blackRating);
  if (!Number.isFinite(whiteRating) || !Number.isFinite(blackRating) || whiteRating <= 0 || blackRating <= 0) return null;
  const gap = Math.abs(Math.round(whiteRating) - Math.round(blackRating));
  const stronger = whiteRating >= blackRating ? "w" : "b";
  const weaker = stronger === "w" ? "b" : "w";
  const plan = hintPlan(gap);
  const mode = input.mode === "pieces" || input.mode === "both" ? input.mode : "hints";
  const pieceIds = mode === "hints" ? [] : piecesForGap(gap);
  const removed = pieceIds.map((id) => ({ color: stronger, id }));
  let weakN = plan.weaker;
  let strongN = plan.stronger;
  if (mode === "both" && !plan.even) weakN = Math.max(1, Math.round(weakN / 2));
  const hints = { w: null, b: null };
  if (mode === "hints" || mode === "both") {
    hints[stronger] = strongN;
    hints[weaker] = weakN;
  }
  const strongName = displayName(stronger === "w" ? input.whiteName : input.blackName, stronger === "w" ? "White" : "Black");
  const weakName = displayName(stronger === "w" ? input.blackName : input.whiteName, stronger === "w" ? "Black" : "White");
  let line;
  if (plan.even) {
    line = mode === "pieces"
      ? "Even ratings: no piece odds."
      : "Even ratings: both players get 2 hints.";
  } else if (mode === "hints") {
    line = `${gap} Elo gap: ${strongName} ${strongN} hints, ${weakName} ${weakN} hints.`;
  } else if (mode === "pieces") {
    line = pieceIds.length
      ? `${gap} Elo gap: ${strongName} gives ${listWords(pieceIds)} odds.`
      : `${gap} Elo gap: no piece odds.`;
  } else {
    const odds = pieceIds.length ? `${strongName} gives ${listWords(pieceIds)} odds. ` : "No piece odds. ";
    line = `${gap} Elo gap: ${odds}${strongName} ${strongN} hints, ${weakName} ${weakN} hints.`;
  }
  return { gap, stronger, weaker, mode, removed, hints, line, even: plan.even };
}

/** Build a legal starting FEN with the given pieces removed. Kings are never removed. */
export function buildOddsFen(removed) {
  const files = "abcdefgh";
  const ranks = {
    8: { a: "r", b: "n", c: "b", d: "q", e: "k", f: "b", g: "n", h: "r" },
    7: Object.fromEntries([...files].map((f) => [f, "p"])),
    6: {}, 5: {}, 4: {}, 3: {},
    2: Object.fromEntries([...files].map((f) => [f, "P"])),
    1: { a: "R", b: "N", c: "B", d: "Q", e: "K", f: "B", g: "N", h: "R" },
  };
  const gone = new Set();
  for (const item of removed || []) {
    const sq = SQUARES[item.color] && SQUARES[item.color][item.id];
    if (!sq || sq === "e1" || sq === "e8") continue;
    gone.add(sq);
    const file = sq[0];
    const rank = Number(sq[1]);
    if (ranks[rank]) delete ranks[rank][file];
  }
  const fenRank = (map) => {
    let out = "";
    let empty = 0;
    for (const file of files) {
      if (!map[file]) empty += 1;
      else {
        if (empty) { out += empty; empty = 0; }
        out += map[file];
      }
    }
    if (empty) out += empty;
    return out;
  };
  const board = [8, 7, 6, 5, 4, 3, 2, 1].map((r) => fenRank(ranks[r])).join("/");
  let castle = "";
  if (!gone.has("h1")) castle += "K";
  if (!gone.has("a1")) castle += "Q";
  if (!gone.has("h8")) castle += "k";
  if (!gone.has("a8")) castle += "q";
  if (!castle) castle = "-";
  const fen = `${board} w ${castle} - 0 1`;
  const note = describeRemoved(removed);
  return { fen, label: note ? "Odds: " + note + "." : "" };
}

export function sameRemoval(a, b) {
  const key = (list) => (list || []).map((i) => i.color + ":" + i.id).sort().join(",");
  return key(a) === key(b);
}

export function toggleRemoval(list, color, id) {
  const next = (list || []).filter((i) => !(i.color === color && i.id === id));
  if (next.length === (list || []).length) next.push({ color, id });
  return next;
}
