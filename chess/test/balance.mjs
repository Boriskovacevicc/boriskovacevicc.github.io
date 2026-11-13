import { Chess } from "../vendor/chess.js";
import { hintPlan, piecesForGap, suggestBalance, buildOddsFen, toggleRemoval } from "../balance.js";

let failed = 0;
const t = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failed += 1;
};

t("100 gap gives the weaker player 2 hints", hintPlan(100).weaker === 2 && hintPlan(100).stronger === 2);
t("500 gap gives 6 and 2", hintPlan(500).weaker === 6 && hintPlan(500).stronger === 2);
t("1000 gap gives 11 and 1", hintPlan(1000).weaker === 11 && hintPlan(1000).stronger === 1);
t("2100 gap gives 22 and 0", hintPlan(2100).weaker === 22 && hintPlan(2100).stronger === 0);
t("hints cap at 30", hintPlan(5000).weaker === 30 && hintPlan(5000).stronger === 0);
t("under 75 both get 2", hintPlan(74).weaker === 2 && hintPlan(74).stronger === 2 && hintPlan(0).even === true);
t("600 is one hint for the stronger player", hintPlan(600).stronger === 1);
t("1200 is no hints for the stronger player", hintPlan(1200).stronger === 0);

const line = suggestBalance({ whiteName: "Boris", blackName: "Mum", whiteRating: 1500, blackRating: 1000, mode: "hints" });
t("friendly hint line", line.line === "500 Elo gap: Boris 2 hints, Mum 6 hints.", line.line);
t("hints are assigned to the colours", line.hints.w === 2 && line.hints.b === 6);

const both = suggestBalance({ whiteName: "Boris", blackName: "Mum", whiteRating: 1500, blackRating: 1000, mode: "both" });
t("both mode halves the weaker hints", both.hints.b === 3 && both.hints.w === 2, JSON.stringify(both.hints));
t("both mode removes the queen at a 500 gap", both.removed.length === 1 && both.removed[0].id === "queen" && both.removed[0].color === "w");

t("under 100 removes nothing", piecesForGap(99).length === 0);
t("100 removes the f-pawn", piecesForGap(100).join() === "f-pawn");
t("200 removes the knight", piecesForGap(200).join() === "knight");
t("350 removes the rook", piecesForGap(350).join() === "rook");
t("500 removes the queen", piecesForGap(500).join() === "queen");
t("700 removes queen and knight", piecesForGap(700).join() === "queen,knight");
t("1000 removes queen and rook", piecesForGap(1000).join() === "queen,rook");
t("1400 removes rook, knight and pawn", piecesForGap(1400).join() === "rook,knight,f-pawn");
t("1800 adds the queen as well", piecesForGap(1800).join() === "queen,rook,knight,f-pawn");

const even = suggestBalance({ whiteName: "Boris", blackName: "Mum", whiteRating: 1420, blackRating: 1400, mode: "both" });
t("an even game is not halved", even.even && even.hints.w === 2 && even.hints.b === 2 && even.removed.length === 0, even.line);

function legal(removed, expectMissing, castle) {
  const { fen } = buildOddsFen(removed);
  let chess;
  try { chess = new Chess(fen); } catch (e) { return "throw " + e.message + " " + fen; }
  if (chess.get("e1").type !== "k" || chess.get("e8").type !== "k") return "king missing " + fen;
  for (const sq of expectMissing) if (chess.get(sq)) return sq + " still there " + fen;
  const rights = fen.split(" ")[2];
  if (castle && rights !== castle) return "castle " + rights + " wanted " + castle + " " + fen;
  if (!chess.moves().length && !chess.isGameOver()) return "no moves " + fen;
  const move = chess.moves({ verbose: true })[0];
  if (move) chess.move(move);
  return "";
}

const cases = [
  [[], [], "KQkq"],
  [[{ color: "w", id: "f-pawn" }], ["f2"], "KQkq"],
  [[{ color: "w", id: "knight" }], ["b1"], "KQkq"],
  [[{ color: "w", id: "rook" }], ["a1"], "Kkq"],
  [[{ color: "b", id: "rook" }], ["a8"], "KQk"],
  [[{ color: "w", id: "rook-k" }], ["h1"], "Qkq"],
  [[{ color: "w", id: "queen" }], ["d1"], "KQkq"],
  [[{ color: "b", id: "queen" }, { color: "b", id: "knight" }], ["d8", "b8"], "KQkq"],
  [[{ color: "w", id: "queen" }, { color: "w", id: "rook" }], ["d1", "a1"], "Kkq"],
  [[{ color: "b", id: "rook" }, { color: "b", id: "knight" }, { color: "b", id: "f-pawn" }], ["a8", "b8", "f7"], "KQk"],
  [[{ color: "w", id: "queen" }, { color: "w", id: "rook" }, { color: "w", id: "knight" }, { color: "w", id: "f-pawn" }], ["d1", "a1", "b1", "f2"], "Kkq"],
];
for (const [removed, missing, castle] of cases) {
  const err = legal(removed, missing, castle);
  t("legal odds " + (removed.map((r) => r.color + r.id).join("+") || "standard"), !err, err);
}

const toggled = toggleRemoval([{ color: "w", id: "queen" }], "w", "queen");
t("tapping a removed piece puts it back", toggled.length === 0);
t("tapping adds a piece", toggleRemoval([], "b", "rook").length === 1);

const play = new Chess(buildOddsFen([{ color: "w", id: "queen" }]).fen);
const e4 = play.move({ from: "e2", to: "e4" });
t("odds position can be played", !!e4 && e4.san === "e4" && play.get("e4").type === "p" && !play.get("d1"));

if (failed) process.exit(1);
