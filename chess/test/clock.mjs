import { makeClock, applyElapsed, afterMove, pauseClock, resumeClock, flagResult, canForceMate, formatClock } from "../clock.js";

let failed = 0;
const t = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failed += 1;
};

let clock = makeClock({ baseMin: 1, incSec: 3, advanced: false });
t("one minute is 60000 ms", clock.remaining.w === 60000);
clock = armRun(clock, "w");
clock = applyElapsed(clock, 1000);
t("a second leaves 59s", clock.remaining.w === 59000 && clock.remaining.b === 60000);
clock = afterMove(clock, "w", 1);
t("increment is added to the mover", clock.remaining.w === 62000, String(clock.remaining.w));
t("the other clock starts after the move", clock.active === "b" && clock.running);

clock = makeClock({ baseMin: 5, incSec: 2, advanced: true, phaseMove: 2, phaseBonusMin: 15, phaseIncSec: 10 });
clock = armRun(clock, "w");
clock = afterMove(clock, "w", 1);
clock = afterMove(clock, "b", 2);
t("phase 1 increment before the bonus move", clock.remaining.w === 5 * 60000 + 2000);
clock = afterMove(clock, "w", 3);
t("phase-2 bonus lands on White's second move", clock.remaining.w === 5 * 60000 + 2000 + 2000 + 15 * 60000, String(clock.remaining.w));
t("White is now in phase 2", clock.phase.w === 2 && clock.phase.b === 1);
clock = afterMove(clock, "b", 4);
clock = afterMove(clock, "w", 5);
t("phase-2 increment replaces the first one", clock.remaining.w === 5 * 60000 + 4000 + 15 * 60000 + 10000);

clock = armRun(makeClock({ baseMin: 1, incSec: 0 }), "w");
clock = pauseClock(applyElapsed(clock, 5000));
const frozen = clock.remaining.w;
clock = applyElapsed(clock, 99999);
t("pause freezes both clocks", clock.paused && clock.remaining.w === frozen && clock.remaining.b === 60000);
clock = resumeClock(clock);
clock = applyElapsed(clock, 1000);
t("resume spends time again", clock.remaining.w === frozen - 1000);

clock = armRun(makeClock({ baseMin: 1, incSec: 5 }), "b");
clock = applyElapsed(clock, 60000);
t("flag marks the player", clock.flagged === "b" && clock.remaining.b === 0);
t("flag is a loss when the opponent can mate", flagResult("b", true).score === "1-0");
t("flag is a draw without mating material", flagResult("w", false).kind === "draw");
t("king and knight cannot force mate", canForceMate(["k", "n"]) === false && canForceMate(["k", "q"]) === true);
t("clock format", formatClock(65000) === "1:05" && formatClock(0) === "0:00");
t("no base time means no clock", makeClock({ baseMin: 0, incSec: 5 }) === null);

function armRun(clock, color) {
  return { ...clock, active: color, running: true, paused: false };
}

if (failed) process.exit(1);
