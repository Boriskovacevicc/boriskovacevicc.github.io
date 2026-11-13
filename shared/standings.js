import { nameKey, normaliseName } from "./store.js";

/** Riki Tiki: most wins, then highest average points. */
export function rikiStandings(matches) {
  const map = new Map();
  for (const match of matches || []) {
    const players = match.players || [];
    players.forEach((player, index) => {
      const name = normaliseName(player && player.name != null ? player.name : player);
      const key = nameKey(name);
      if (!key) return;
      if (!map.has(key)) map.set(key, { name, wins: 0, points: 0, played: 0 });
      const row = map.get(key);
      row.played += 1;
      const total = match.totals && match.totals[index];
      row.points += Number(total) || 0;
      const byId = player && player.id && (match.winnerIds || []).includes(player.id);
      const byName = (match.winnerNames || []).some((n) => nameKey(n) === key);
      if (byId || byName) row.wins += 1;
    });
  }
  return [...map.values()]
    .map((row) => ({ ...row, avg: row.played ? row.points / row.played : 0 }))
    .sort((a, b) => b.wins - a.wins || b.avg - a.avg || a.name.localeCompare(b.name));
}

/** Tablice: wins, then win rate, then average points per round. Pair wins count for both partners. */
export function tabliceStandings(matches) {
  const map = new Map();
  for (const match of matches || []) {
    if (!match || match.void || !Array.isArray(match.players)) continue;
    const rounds = Array.isArray(match.rounds) ? match.rounds : [];
    const sides = Array.isArray(match.sides) ? match.sides : [];
    match.players.forEach((player, index) => {
      const name = normaliseName(player && player.name != null ? player.name : player);
      const key = nameKey(name);
      if (!key) return;
      if (!map.has(key)) map.set(key, { name, wins: 0, games: 0, points: 0, rounds: 0, tablas: 0 });
      const row = map.get(key);
      row.games += 1;
      const side = sides.findIndex((item) => (item.members || []).includes(index));
      for (const round of rounds) {
        row.rounds += 1;
        if (side >= 0) row.points += Number(round.points && round.points[side]) || 0;
        row.tablas += Number(round.tablas && round.tablas[index]) || 0;
      }
      if (player && player.id && (match.winnerIds || []).includes(player.id)) row.wins += 1;
    });
  }
  return [...map.values()]
    .map((row) => ({
      ...row,
      rate: row.games ? row.wins / row.games : 0,
      avg: row.rounds ? row.points / row.rounds : 0,
    }))
    .sort((a, b) => b.wins - a.wins || b.rate - a.rate || b.avg - a.avg || a.name.localeCompare(b.name));
}

/** Chess: most wins, then best win rate. Draws count as games and not as wins. */
export function chessStandings(results, seriesList) {
  const map = new Map();
  const touch = (name) => {
    const clean = normaliseName(name);
    const key = nameKey(clean);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { name: clean, wins: 0, games: 0, seriesWins: 0 });
    return map.get(key);
  };
  for (const game of results || []) {
    const white = touch(game.white);
    const black = touch(game.black);
    if (white) {
      white.games += 1;
      if (game.result === "1-0") white.wins += 1;
    }
    if (black) {
      black.games += 1;
      if (game.result === "0-1") black.wins += 1;
    }
  }
  for (const series of seriesList || []) {
    if (!series || !series.finished || series.drawn || !series.winnerKey) continue;
    const winner = series.winnerKey === series.keyW ? series.nameW : series.nameB;
    const row = touch(winner);
    if (row) row.seriesWins += 1;
  }
  return [...map.values()]
    .map((row) => ({ ...row, rate: row.games ? row.wins / row.games : 0 }))
    .sort((a, b) => b.wins - a.wins || b.seriesWins - a.seriesWins || b.rate - a.rate || a.name.localeCompare(b.name));
}
