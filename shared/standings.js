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

/** Chess: most wins, then best win rate. Draws count as games and not as wins. */
export function chessStandings(results) {
  const map = new Map();
  const touch = (name) => {
    const clean = normaliseName(name);
    const key = nameKey(clean);
    if (!key) return null;
    if (!map.has(key)) map.set(key, { name: clean, wins: 0, games: 0 });
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
  return [...map.values()]
    .map((row) => ({ ...row, rate: row.games ? row.wins / row.games : 0 }))
    .sort((a, b) => b.wins - a.wins || b.rate - a.rate || a.name.localeCompare(b.name));
}
