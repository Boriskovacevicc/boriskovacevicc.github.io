/** Tablice scoring. Card points are separate from tabla bonuses. */

export const CARD_POINTS = 22;
export const MOST_BONUS = 3;
/** A side locks tablas once it ends a round at target − LOCK_GAP (90 in a 101 game, 40 in a 51 game). */
export const LOCK_GAP = 11;

export function defaultTarget(playerCount) {
  return playerCount === 3 ? 51 : 101;
}

export function lockThreshold(target) {
  return Number(target) - LOCK_GAP;
}

/** Pairs deal Team A, Team B, Team A, Team B: seats 0, 2, 1, 3. */
export function dealerOrder(playerCount, mode) {
  if (playerCount === 4 && mode === "pairs") return [0, 2, 1, 3];
  return Array.from({ length: playerCount }, (_, i) => i);
}

export function dealerPlayer(roundIndex, playerCount, mode, firstDealer) {
  const order = dealerOrder(playerCount, mode);
  const start = Math.max(0, order.indexOf(firstDealer));
  return order[(start + roundIndex) % order.length];
}

export function makeSides(names, mode) {
  const clean = names.map((name, i) => String(name || "").trim() || `Player ${i + 1}`);
  if (clean.length === 4 && mode === "pairs") {
    return [
      { label: `${clean[0]} & ${clean[1]}`, members: [0, 1] },
      { label: `${clean[2]} & ${clean[3]}`, members: [2, 3] },
    ];
  }
  return clean.map((label, i) => ({ label, members: [i] }));
}

export function hasMostCards(playerCount) {
  return playerCount !== 3;
}

/** most is a side index, "tie", or "unset". Three players never take a bonus. */
export function bonusPoints(playerCount, most) {
  if (!hasMostCards(playerCount) || most === "tie" || most === "unset" || most == null) return 0;
  return MOST_BONUS;
}

export function expectedCardTotal(playerCount, most) {
  if (!hasMostCards(playerCount) || most === "tie" || most == null) return CARD_POINTS;
  return CARD_POINTS + MOST_BONUS;
}

export function cardTotal(cards, playerCount, most) {
  const sum = (cards || []).reduce((total, n) => total + (Number(n) || 0), 0);
  return sum + bonusPoints(playerCount, most);
}

export function sideRoundPoints(cards, tablas, sides, playerCount, most) {
  return sides.map((side, sideIndex) => {
    const fromCards = Number(cards && cards[sideIndex]) || 0;
    const bonus = most === sideIndex ? bonusPoints(playerCount, most) : 0;
    const fromTablas = side.members.reduce((total, playerIndex) => total + (Number(tablas && tablas[playerIndex]) || 0), 0);
    return fromCards + bonus + fromTablas;
  });
}

export function project(rounds, sides, playerCount, target) {
  const totals = sides.map(() => 0);
  const history = [];
  for (const round of rounds || []) {
    const most = hasMostCards(playerCount) ? round.most : "tie";
    const points = sideRoundPoints(round.cards, round.tablas, sides, playerCount, most);
    points.forEach((pointsForSide, index) => { totals[index] += pointsForSide; });
    history.push({ points: points.slice(), totals: totals.slice(), most });
  }
  return { history, totals: totals.slice(), target };
}

/** Locks use the score at the end of the previous round, never mid-entry. */
export function lockedSides(totalsBefore, target) {
  const line = lockThreshold(target);
  return (totalsBefore || []).map((score) => score >= line);
}

export function outcome(totals, target) {
  const reached = (totals || []).map((score, index) => ({ index, score })).filter((row) => row.score >= target);
  if (!reached.length) return { finished: false, tie: false, winner: null };
  const best = Math.max(...reached.map((row) => row.score));
  const top = reached.filter((row) => row.score === best);
  if (top.length > 1) return { finished: false, tie: true, winner: null };
  return { finished: true, tie: false, winner: top[0].index };
}

/**
 * Warn when card points (tablas excluded, most-cards bonus included) are not 22 or 25.
 * Skip the warning on a declared final round, or when this round already crowns a winner.
 */
export function checkRound({ cards, most, tablas, sides, playerCount, totalsBefore, target, finalRound }) {
  const mostUsed = hasMostCards(playerCount) ? most : "tie";
  const points = sideRoundPoints(cards, tablas, sides, playerCount, mostUsed);
  const after = (totalsBefore || sides.map(() => 0)).map((score, index) => score + points[index]);
  const result = outcome(after, target);
  const base = { points, after, finished: result.finished, tie: result.tie, winner: result.winner };
  if (finalRound || result.finished) return { ...base, warn: false, reason: "" };
  if (hasMostCards(playerCount) && (mostUsed === "unset" || mostUsed == null)) {
    return { ...base, warn: true, reason: "pick", expected: null, got: cardTotal(cards, playerCount, "tie") };
  }
  const expected = expectedCardTotal(playerCount, mostUsed);
  const got = cardTotal(cards, playerCount, mostUsed);
  if (got !== expected) return { ...base, warn: true, reason: "sum", expected, got };
  return { ...base, warn: false, reason: "", expected, got };
}

/**
 * True when 22 card points cannot be shared without someone reaching the target.
 * Bonus and tablas are ignored. Each side can absorb max(0, target − 1 − score)
 * points and still stay short. 95–96 to 101 has room 5 + 4 = 9, so it is final.
 * 99–66 has room 1 + 34 = 35, so it is not.
 */
export function forcedFinal(totals, target) {
  const room = (totals && totals.length ? totals : [0]).reduce(
    (sum, score) => sum + Math.max(0, Number(target) - 1 - (Number(score) || 0)),
    0,
  );
  return room < CARD_POINTS;
}

/** Finish game ends the match only when one side has reached the target. */
export function finishDecision(check, target) {
  if (check.finished) return { end: true, note: "" };
  if (check.tie) return { end: false, note: `It's a tie on ${target}. Keep playing — the higher score wins.` };
  return { end: false, note: `Nobody has reached ${target} yet. Add the points that finish the game, or save the round.` };
}

/** Index of the first round that produces a unique winner, or -1. */
export function winningRound(history, target) {
  for (let i = 0; i < history.length; i += 1) {
    if (outcome(history[i].totals, target).finished) return i;
  }
  return -1;
}
