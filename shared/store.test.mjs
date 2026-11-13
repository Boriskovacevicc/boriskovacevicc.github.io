const mem = new Map();
globalThis.localStorage = {
  getItem: (k) => (mem.has(k) ? mem.get(k) : null),
  setItem: (k, v) => mem.set(k, String(v)),
  removeItem: (k) => mem.delete(k),
  clear: () => mem.clear(),
};

const store = await import("./store.js");
const { rikiStandings, chessStandings } = await import("./standings.js");

let failed = 0;
const t = (name, cond, extra = "") => {
  console.log(`${cond ? "PASS" : "FAIL"}  ${name}${extra ? "  — " + extra : ""}`);
  if (!cond) failed += 1;
};

const boris = await store.rememberPlayer("boris kovacevic");
const again = await store.rememberPlayer("Boris Kovacevic", { chesscom: 1500 });
t("Boris Kovacevic is stored once", boris.id === again.id);
t("proper capitals are kept", again.name === "Boris Kovacevic", again.name);
t("chess.com rating is saved on the player", again.chesscom === 1500);
t("directory key is boki-players-v1", localStorage.getItem(store.STORE_KEYS.players).includes("Boris Kovacevic"));

const mum = await store.rememberPlayer("Mum", { chesscom: 1000 });
t("a second player is separate", mum.id !== again.id && (await store.listPlayers()).length === 2);

const legacy = { version: 1, profiles: [{ id: "p1", name: "Boris Kovacevic" }], matches: [], setupCount: 4 };
localStorage.setItem(store.STORE_KEYS.rikiV1, JSON.stringify(legacy));
const loadedLegacy = await store.loadRiki();
t("Riki Tiki v1 is still readable", loadedLegacy && loadedLegacy.profiles[0].name === "Boris Kovacevic");
await store.saveRiki({ version: 2, profiles: legacy.profiles, matches: [{ id: "m1", players: [{ id: "p1", name: "Boris Kovacevic" }], totals: [10], winnerIds: ["p1"] }] });
t("saving Riki writes rikki-tikki-v2", !!localStorage.getItem(store.STORE_KEYS.riki));
t("saving Riki leaves rikki-tikki-v1 in place", !!localStorage.getItem(store.STORE_KEYS.rikiV1));
const v2 = await store.loadRiki();
t("v2 is preferred once it exists", v2.version === 2);

const game = {
  id: "cg1", date: "2026-01-01T12:00:00.000Z",
  white: "Boris Kovacevic", black: "Mum", result: "1-0",
  winner: "Boris Kovacevic", loser: "Mum",
};
await store.recordChessResult(game);
await store.recordChessResult(game);
t("chess result is stored once", (await store.listChessResults()).length === 1);
t("chess results key is boki-chess-results-v1", !!localStorage.getItem(store.STORE_KEYS.chessResults));
await store.removeChessResult("cg1");
t("a taken-back chess result is removed", (await store.listChessResults()).length === 0);

const ranks = rikiStandings([
  { players: [{ id: "a", name: "Boris Kovacevic" }, { id: "b", name: "Mum" }], totals: [20, 5], winnerIds: ["a"], winnerNames: ["Boris Kovacevic"] },
  { players: [{ id: "a", name: "Boris Kovacevic" }, { id: "b", name: "Mum" }], totals: [4, 12], winnerIds: ["b"], winnerNames: ["Mum"] },
  { players: [{ id: "a", name: "Boris Kovacevic" }, { id: "b", name: "Mum" }], totals: [8, 8], winnerIds: ["a", "b"], winnerNames: ["Boris Kovacevic", "Mum"] },
]);
t("Riki ranks by wins then average points", ranks[0].name === "Boris Kovacevic" && ranks[0].wins === 2 && ranks[1].wins === 2 && ranks[0].avg > ranks[1].avg, JSON.stringify(ranks));

await store.recordChessResult({ id: "c1", white: "Boris Kovacevic", black: "Mum", result: "1-0" });
await store.recordChessResult({ id: "c2", white: "Mum", black: "Boris Kovacevic", result: "1/2-1/2" });
await store.recordChessResult({ id: "c3", white: "Mum", black: "Boris Kovacevic", result: "0-1" });
const chessRanks = chessStandings(await store.listChessResults());
t("chess ranks Boris first on wins", chessRanks[0].name === "Boris Kovacevic" && chessRanks[0].wins === 2, JSON.stringify(chessRanks));
t("a draw is a game and not a win", chessRanks[0].games === 3 && chessRanks[1].wins === 0);

if (failed) process.exit(1);
