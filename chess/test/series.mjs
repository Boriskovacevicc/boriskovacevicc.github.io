import { setColourChoice, resolveColours, coloursForGame, addSeriesGame, undoSeriesGame, freshSeries, removalsForGame, hintsForGame } from "../series.js";

let failed = 0;
const t = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failed += 1;
};

let pick = { W: "w", B: "b" };
pick = setColourChoice(pick, "W", "b");
t("choosing Black for one sets White for the other", pick.W === "b" && pick.B === "w");
pick = setColourChoice(pick, "B", "r");
t("Random does not force the other player", pick.B === "r" && pick.W === "b");
const fixed = resolveColours({ W: "r", B: "w" }, 0.9);
t("a chosen White still gets White", fixed.W === "b" && fixed.B === "w");
const rolled = resolveColours({ W: "r", B: "r" }, 0.1);
t("both Random can give the first seat White", rolled.W === "w" && rolled.B === "b" && rolled.random);
const other = resolveColours({ W: "r", B: "r" }, 0.9);
t("both Random can give the first seat Black", other.W === "b" && other.B === "w");

const first = { W: "w", B: "b" };
t("game 2 swaps colours", coloursForGame(first, 1).W === "b" && coloursForGame(first, 2).W === "w");

let series = freshSeries({
  target: 2.5,
  nameW: "Boris Kovacevic",
  nameB: "Mum",
  firstColours: first,
  hints: { W: 2, B: 6 },
  removedBySeat: { W: [], B: ["queen"] },
  styles: { W: "cburnett", B: "neon" },
  control: { baseMin: 5, incSec: 3 },
});
series = addSeriesGame(series, { id: "g1", result: "1-0", whiteKey: series.keyW, blackKey: series.keyB });
t("a win is one point", series.scores[series.keyW] === 1 && !series.finished);
series = addSeriesGame(series, { id: "g2", result: "1/2-1/2", whiteKey: series.keyB, blackKey: series.keyW });
t("a draw is half a point each", series.scores[series.keyW] === 1.5 && series.scores[series.keyB] === 0.5);
series = addSeriesGame(series, { id: "g3", result: "0-1", whiteKey: series.keyB, blackKey: series.keyW });
t("first to 2.5 wins the series", series.finished && series.winnerKey === series.keyW && series.scores[series.keyW] === 2.5);

const drawn = addSeriesGame(addSeriesGame(freshSeries({
  target: 1, nameW: "A", nameB: "B", firstColours: first,
  hints: { W: 3, B: 3 }, removedBySeat: { W: [], B: [] }, styles: { W: "cburnett", B: "cburnett" },
}), { id: "d0", result: "1-0", whiteKey: "a", blackKey: "b" }), { id: "d1", result: "1/2-1/2", whiteKey: "b", blackKey: "a" });
// rebuild properly with matching keys
let s2 = freshSeries({
  target: 1, nameW: "Ada", nameB: "Bea", firstColours: first,
  hints: { W: 3, B: 3 }, removedBySeat: { W: ["rook"], B: [] }, styles: { W: "merida", B: "celtic" },
});
s2 = addSeriesGame(s2, { id: "x", result: "1/2-1/2", whiteKey: s2.keyW, blackKey: s2.keyB });
s2 = addSeriesGame(s2, { id: "y", result: "1/2-1/2", whiteKey: s2.keyB, blackKey: s2.keyW });
t("a final draw that crosses for both is a drawn series", s2.finished && s2.drawn && !s2.winnerKey && s2.scores[s2.keyW] === 1 && s2.scores[s2.keyB] === 1, JSON.stringify(s2.scores));

const back = undoSeriesGame(series, { id: "g3", result: "0-1", whiteKey: series.keyB, blackKey: series.keyW });
t("undoing the last game rewinds the score", back.scores[series.keyW] === 1.5 && !back.finished);

const swapped = { W: "b", B: "w" };
const removed = removalsForGame(series, swapped);
t("the queen odds stay with Mum when she plays White", removed.some((r) => r.color === "w" && r.id === "queen") && !removed.some((r) => r.color === "b"));
const hints = hintsForGame(series, swapped);
t("hint counts follow the player", hints.b === 2 && hints.w === 6);

if (failed) process.exit(1);
