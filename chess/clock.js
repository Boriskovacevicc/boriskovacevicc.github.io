/** Time controls. Time only moves while the page is open and the clock is running. */

export function makeClock(control) {
  const baseMin = Number(control && control.baseMin) || 0;
  if (baseMin <= 0) return null;
  const ms = Math.round(baseMin * 60 * 1000);
  return {
    control: {
      baseMin,
      incSec: clampNum(control.incSec, 0, 60),
      advanced: !!control.advanced,
      phaseMove: clampNum(control.phaseMove || 40, 1, 200),
      phaseBonusMin: clampNum(control.phaseBonusMin || 0, 0, 120),
      phaseIncSec: clampNum(control.phaseIncSec != null ? control.phaseIncSec : control.incSec, 0, 60),
    },
    remaining: { w: ms, b: ms },
    phase: { w: 1, b: 1 },
    running: false,
    paused: false,
    active: null,
    flagged: null,
  };
}

function clampNum(n, lo, hi) {
  const x = Number(n);
  if (!Number.isFinite(x)) return lo;
  return Math.min(hi, Math.max(lo, x));
}

export function arm(clock, color) {
  if (!clock || clock.flagged) return clock;
  return { ...clock, active: color, running: !clock.paused };
}

/** Subtract ms from the active player. Does nothing while paused or stopped. */
export function applyElapsed(clock, ms) {
  if (!clock || !clock.running || clock.paused || clock.flagged || !clock.active) return clock;
  const dt = Math.max(0, Number(ms) || 0);
  const remaining = { ...clock.remaining };
  remaining[clock.active] = Math.max(0, remaining[clock.active] - dt);
  const flagged = remaining[clock.active] === 0 ? clock.active : null;
  return { ...clock, remaining, flagged, running: flagged ? false : clock.running };
}

export function pauseClock(clock) {
  if (!clock) return clock;
  return { ...clock, paused: true, running: false };
}

export function resumeClock(clock) {
  if (!clock || clock.flagged) return clock;
  return { ...clock, paused: false, running: !!clock.active };
}

/**
 * The mover has just completed a move. plyCount is the number of plies now on the board.
 * Increment is the one for the phase the move was played in. A phase-2 bonus is added
 * when that player reaches the chosen move number, then their increment changes.
 */
export function afterMove(clock, mover, plyCount) {
  if (!clock || clock.flagged) return clock;
  const remaining = { ...clock.remaining };
  const phase = { ...clock.phase };
  const inc = phase[mover] === 1 ? clock.control.incSec : clock.control.phaseIncSec;
  remaining[mover] += Math.round(inc * 1000);
  const moveNo = mover === "w" ? Math.ceil(plyCount / 2) : Math.floor(plyCount / 2);
  if (clock.control.advanced && phase[mover] === 1 && moveNo >= clock.control.phaseMove) {
    remaining[mover] += Math.round(clock.control.phaseBonusMin * 60 * 1000);
    phase[mover] = 2;
  }
  const next = mover === "w" ? "b" : "w";
  return {
    ...clock,
    remaining,
    phase,
    active: next,
    running: !clock.paused,
    flagged: null,
  };
}

export function formatClock(ms) {
  const total = Math.max(0, Math.ceil((Number(ms) || 0) / 1000));
  const s = total % 60;
  const m = Math.floor(total / 60);
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  }
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** True when this side has more than a king and a minor piece. */
export function canForceMate(pieceTypes) {
  const rest = (pieceTypes || []).filter((t) => t !== "k");
  if (rest.length === 0) return false;
  if (rest.length === 1 && (rest[0] === "n" || rest[0] === "b")) return false;
  return true;
}

export function flagResult(flagColor, opponentCanMate) {
  if (!opponentCanMate) return { kind: "draw", score: "1/2-1/2", winner: null };
  const winner = flagColor === "w" ? "b" : "w";
  return { kind: "loss", score: winner === "w" ? "1-0" : "0-1", winner };
}
