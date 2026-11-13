import {
  CARD_POINTS, LOCK_GAP, defaultTarget, lockThreshold, dealerOrder, dealerPlayer, makeSides,
  checkRound, lockedSides, outcome, project, sideRoundPoints, forcedFinal, finishDecision,
} from "../score.js";

let failed = 0;
const t = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failed += 1;
};

t("defaults are 101, 101, and 51", defaultTarget(2) === 101 && defaultTarget(4) === 101 && defaultTarget(3) === 51);
t("lock sits 11 under the target", LOCK_GAP === 11 && lockThreshold(101) === 90 && lockThreshold(51) === 40);

const pairs = dealerOrder(4, "pairs");
t("pairs deal A1, B1, A2, B2", pairs.join(",") === "0,2,1,3");
t("first dealer can be the second seat", dealerPlayer(0, 4, "pairs", 2) === 2 && dealerPlayer(1, 4, "pairs", 2) === 1);
t("solo dealing walks the circle", dealerPlayer(3, 3, "solo", 0) === 0);

const teamSides = makeSides(["Boki", "Mama", "Tata", "Ana"], "pairs");
t("pairs scoreboard is two teams", teamSides.length === 2 && teamSides[0].label === "Boki & Mama" && teamSides[1].members.join(",") === "2,3");

const solo4 = makeSides(["A", "B", "C", "D"], "solo");
t("four individuals are four columns", solo4.length === 4);

const two = makeSides(["Boki", "Mama"], "solo");
const ok = checkRound({
  cards: [12, 10], most: 0, tablas: [0, 0], sides: two, playerCount: 2, totalsBefore: [0, 0], target: 101, finalRound: false,
});
t("a most-cards round totals 25", ok.warn === false && ok.points[0] === 15 && ok.points[1] === 10 && ok.points[0] + ok.points[1] === 25);

const tie = checkRound({
  cards: [11, 11], most: "tie", tablas: [2, 0], sides: two, playerCount: 2, totalsBefore: [0, 0], target: 101, finalRound: false,
});
t("a tie is 22 and tablas sit outside the check", tie.warn === false && tie.points[0] === 13 && tie.points[1] === 11);

const bad = checkRound({
  cards: [10, 10], most: 0, tablas: [5, 0], sides: two, playerCount: 2, totalsBefore: [0, 0], target: 101, finalRound: false,
});
t("23 card points warn, even with tablas", bad.warn === true && bad.reason === "sum" && bad.got === 23 && bad.expected === 25);

const three = makeSides(["A", "B", "C"], "solo");
const threeRound = checkRound({
  cards: [8, 7, 7], most: 0, tablas: [1, 0, 0], sides: three, playerCount: 3, totalsBefore: [0, 0, 0], target: 51, finalRound: false,
});
t("three players ignore most-cards and expect 22", threeRound.warn === false && threeRound.points[0] === 9 && threeRound.points.reduce((s, n) => s + n, 0) === 23);

const short = checkRound({
  cards: [4, 2, 1], most: "unset", tablas: [0, 0, 0], sides: three, playerCount: 3, totalsBefore: [48, 10, 0], target: 51, finalRound: false,
});
t("a short total is fine when the round wins the game", short.warn === false && short.finished && short.winner === 0);

const manual = checkRound({
  cards: [4, 4], most: 0, tablas: [0, 0], sides: two, playerCount: 2, totalsBefore: [10, 10], target: 101, finalRound: true,
});
t("final round checkbox skips the check", manual.warn === false && manual.finished === false);

const both = checkRound({
  cards: [20, 18], most: "tie", tablas: [0, 0], sides: two, playerCount: 2, totalsBefore: [90, 85], target: 101, finalRound: false,
});
t("the higher score wins when both pass", both.finished && both.winner === 0 && both.warn === false);

const level = outcome([101, 101], 101);
t("an exact tie keeps the game going", level.finished === false && level.tie === true);

const before = [89, 20];
t("89 is not locked yet", lockedSides(before, 101)[0] === false);
const atLine = checkRound({
  cards: [12, 10], most: 0, tablas: [1, 0], sides: two, playerCount: 2, totalsBefore: before, target: 101, finalRound: false,
});
t("a side on 89 can still add a tabla this round", atLine.points[0] === 16 && atLine.after[0] === 105);
t("90 locks the next round", lockedSides(atLine.after, 101)[0] === true && lockedSides(atLine.after, 101)[1] === false);
t("51-game lock is 40", lockedSides([40, 39], 51)[0] === true && lockedSides([40, 39], 51)[1] === false);

const teamPoints = sideRoundPoints([10, 12], [1, 2, 0, 3], teamSides, 4, 1);
t("tablas from both partners land on the team", teamPoints[0] === 13 && teamPoints[1] === 18);

const played = project([
  { cards: [12, 10], most: 0, tablas: [0, 0] },
  { cards: [11, 11], most: "tie", tablas: [0, 0] },
], two, 2, 101);
t("running totals add up", played.totals.join(",") === "26,21" && played.history.length === 2);
t("card pot constant stays 22", CARD_POINTS === 22);
t("95–96 to 101 is a final round", forcedFinal([95, 96], 101) === true);
t("99–66 to 101 is not final", forcedFinal([99, 66], 101) === false);
t("100–80 cannot absorb 22", forcedFinal([100, 80], 101) === true);
t("100–50 can still take a quiet 22", forcedFinal([100, 50], 101) === false);
t("a tied 44–44 to 51 is final", forcedFinal([44, 44], 51) === true);
const early = finishDecision({ finished: false, tie: false }, 101);
t("finish game waits until someone reaches the target", early.end === false && early.note.includes("101"));
t("finish game ends on a winner", finishDecision({ finished: true, tie: false }, 101).end === true);
t("finish game will not crown a tie", finishDecision({ finished: false, tie: true }, 101).end === false);

if (failed) process.exit(1);
