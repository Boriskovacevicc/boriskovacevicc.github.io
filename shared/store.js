/**
 * Async storage for the shared player directory, Riki Tiki history
 * (profiles and finished matches) and chess results.
 *
 * localStorage is the offline cache. When Firebase is configured and this
 * runs in a browser, the same records are merged with Firestore.
 * In-progress games stay on the device.
 */
import { storeConfig } from "./store.config.js";

export const STORE_KEYS = {
  players: "boki-players-v1",
  riki: "rikki-tikki-v2",
  rikiV1: "rikki-tikki-v1",
  chessResults: "boki-chess-results-v1",
  meta: "boki-store-meta",
};

export function normaliseName(name) {
  return String(name ?? "").trim().replace(/\s+/g, " ");
}

export function nameKey(name) {
  return normaliseName(name).toLowerCase();
}

function cacheGet(key) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch (e) {
    return null;
  }
}

function cacheSet(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

function stamp(name) {
  const next = cacheGet(STORE_KEYS.meta) || {};
  next[name] = Date.now();
  cacheSet(STORE_KEYS.meta, next);
}

function cloudOn() {
  return storeConfig.backend === "firebase"
    && storeConfig.firebase
    && storeConfig.firebase.projectId
    && typeof window !== "undefined";
}

let cloudApi = null;
function firebaseApi() {
  if (!cloudApi) cloudApi = import("./firebase.js");
  return cloudApi;
}

function preferName(prev, next) {
  const caps = (s) => (String(s).match(/[A-Z]/g) || []).length;
  return caps(next) > caps(prev) ? next : prev;
}

export function mergeById(localList, remoteList) {
  const map = new Map();
  const put = (item) => {
    if (!item || !item.id) return;
    const prev = map.get(item.id);
    if (!prev) {
      map.set(item.id, item);
      return;
    }
    if (item.removed && !prev.removed) {
      map.set(item.id, { ...prev, ...item });
      return;
    }
    if ((item.updatedAt || 0) >= (prev.updatedAt || 0)) map.set(item.id, { ...prev, ...item });
  };
  (localList || []).forEach(put);
  (remoteList || []).forEach(put);
  return [...map.values()];
}

export function mergePlayers(localList, remoteList) {
  const map = new Map();
  for (const player of [...(localList || []), ...(remoteList || [])]) {
    if (!player || !player.nameKey) continue;
    const prev = map.get(player.nameKey);
    if (!prev) {
      map.set(player.nameKey, player);
      continue;
    }
    const newer = (player.updatedAt || 0) >= (prev.updatedAt || 0) ? player : prev;
    const older = newer === player ? prev : player;
    map.set(player.nameKey, {
      ...older,
      ...newer,
      name: preferName(prev.name, player.name),
      chesscom: newer.chesscom || older.chesscom || null,
      id: prev.id || player.id,
    });
  }
  return [...map.values()];
}

function mergeRiki(local, remoteProfiles, remoteMatches) {
  const base = local && typeof local === "object" ? { ...local } : { version: 2, profiles: [], matches: [] };
  base.profiles = mergeById(base.profiles, remoteProfiles).filter((p) => p && p.id && p.name && !p.removed);
  base.matches = mergeById(base.matches, remoteMatches).filter((m) => m && m.id && !m.removed);
  base.matches.sort((a, b) => String(b.endedAt || "").localeCompare(String(a.endedAt || "")));
  if (!base.version) base.version = 2;
  return base;
}

let bootPromise = null;
async function cloudBoot() {
  if (!cloudOn()) return;
  if (!bootPromise) bootPromise = runCloudBoot().catch((error) => {
    bootPromise = null;
    throw error;
  });
  try { await bootPromise; } catch (e) { /* local cache still works */ }
}

async function runCloudBoot() {
  const fb = await firebaseApi();
  fb.note("syncing");
  const online = await Promise.race([
    fb.start(),
    new Promise((resolve) => setTimeout(() => resolve(false), 8000)),
  ]);
  if (!online) return;
  try {
    const remotePlayers = await fb.pullPlayers();
    const localPlayers = Array.isArray(cacheGet(STORE_KEYS.players)) ? cacheGet(STORE_KEYS.players) : [];
    const players = mergePlayers(localPlayers, remotePlayers).map(stampPlayer);
    cacheSet(STORE_KEYS.players, players);
    for (const player of players) await fb.pushPlayer(player);

    const remoteProfiles = await fb.pullRikiProfiles();
    const remoteMatches = await fb.pullRikiMatches();
    const localRiki = cacheGet(STORE_KEYS.riki) || cacheGet(STORE_KEYS.rikiV1);
    if (localRiki || remoteProfiles.length || remoteMatches.length) {
      const merged = mergeRiki(localRiki, remoteProfiles, remoteMatches);
      cacheSet(STORE_KEYS.riki, merged);
      stamp("riki");
      for (const profile of merged.profiles || []) await fb.pushProfile(withStamp(profile));
      for (const match of merged.matches || []) await fb.pushMatch(withStamp(match));
    }

    const remoteChess = await fb.pullChessResults();
    const localChess = Array.isArray(cacheGet(STORE_KEYS.chessResults)) ? cacheGet(STORE_KEYS.chessResults) : [];
    const chess = mergeById(localChess, remoteChess).map(withStamp);
    cacheSet(STORE_KEYS.chessResults, chess);
    stamp("chessResults");
    for (const game of chess) await fb.pushChessResult(game);
    fb.note(navigator.onLine ? "synced" : "offline");
  } catch (error) {
    fb.note("offline", error && error.code ? error.code : "sync");
  }
}

function withStamp(item) {
  if (!item || item.updatedAt) return item;
  return { ...item, updatedAt: Date.now() };
}

function stampPlayer(player) {
  return withStamp(player);
}

export function ensureCloud() {
  return cloudBoot();
}

export function peekPlayers() {
  const data = cacheGet(STORE_KEYS.players);
  return Array.isArray(data) ? data : [];
}

export function peekRiki() {
  const current = cacheGet(STORE_KEYS.riki);
  if (current && typeof current === "object") return current;
  const legacy = cacheGet(STORE_KEYS.rikiV1);
  return legacy && typeof legacy === "object" ? legacy : null;
}

export async function listPlayers() {
  await cloudBoot();
  const data = cacheGet(STORE_KEYS.players);
  return Array.isArray(data) ? data : [];
}

export async function savePlayers(list) {
  const rows = Array.isArray(list) ? list : [];
  cacheSet(STORE_KEYS.players, rows);
  stamp("players");
  if (cloudOn()) {
    try {
      const fb = await firebaseApi();
      for (const player of rows) await fb.pushPlayer(player);
      fb.note(navigator.onLine ? "synced" : "offline");
    } catch (e) {
      try { (await firebaseApi()).note("offline"); } catch (err) { /* ignore */ }
    }
  }
  return rows;
}

export async function rememberPlayer(name, patch = {}) {
  await cloudBoot();
  const clean = normaliseName(name);
  const key = nameKey(clean);
  if (!key) return null;
  const all = Array.isArray(cacheGet(STORE_KEYS.players)) ? cacheGet(STORE_KEYS.players).slice() : [];
  let player = all.find((p) => p && p.nameKey === key);
  if (!player) {
    player = {
      id: "p_" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4),
      name: clean,
      nameKey: key,
      createdAt: new Date().toISOString(),
      chesscom: null,
      updatedAt: Date.now(),
    };
    all.push(player);
  } else {
    player.name = preferName(player.name, clean);
    player.updatedAt = Date.now();
  }
  if (Object.prototype.hasOwnProperty.call(patch, "chesscom")) {
    const n = Number(patch.chesscom);
    player.chesscom = Number.isFinite(n) && n > 0 ? Math.round(n) : null;
  }
  await savePlayers(all);
  return player;
}

export async function loadRiki() {
  await cloudBoot();
  const current = cacheGet(STORE_KEYS.riki);
  if (current && typeof current === "object") return current;
  const legacy = cacheGet(STORE_KEYS.rikiV1);
  return legacy && typeof legacy === "object" ? legacy : null;
}

export async function saveRiki(snapshot) {
  cacheSet(STORE_KEYS.riki, snapshot);
  stamp("riki");
  if (cloudOn() && snapshot) {
    try {
      const fb = await firebaseApi();
      for (const profile of snapshot.profiles || []) {
        if (profile && profile.id && profile.name) await fb.pushProfile(withStamp(profile));
      }
      for (const match of snapshot.matches || []) {
        if (match && match.id) await fb.pushMatch(withStamp(match));
      }
      fb.note(navigator.onLine ? "synced" : "offline");
    } catch (e) {
      try { (await firebaseApi()).note("offline"); } catch (err) { /* ignore */ }
    }
  }
  return snapshot;
}

export async function listChessResults() {
  await cloudBoot();
  const data = cacheGet(STORE_KEYS.chessResults);
  return (Array.isArray(data) ? data : []).filter((g) => g && !g.removed);
}

async function writeChess(list) {
  cacheSet(STORE_KEYS.chessResults, list);
  stamp("chessResults");
  if (!cloudOn()) return;
  try {
    const fb = await firebaseApi();
    for (const game of list) await fb.pushChessResult(withStamp(game));
    fb.note(navigator.onLine ? "synced" : "offline");
  } catch (e) {
    try { (await firebaseApi()).note("offline"); } catch (err) { /* ignore */ }
  }
}

export async function recordChessResult(game) {
  if (!game || !game.id) return listChessResults();
  await cloudBoot();
  const all = Array.isArray(cacheGet(STORE_KEYS.chessResults)) ? cacheGet(STORE_KEYS.chessResults).slice() : [];
  const stamped = withStamp({ ...game, removed: false, updatedAt: Date.now() });
  const index = all.findIndex((g) => g && g.id === game.id);
  if (index >= 0) all[index] = { ...all[index], ...stamped, removed: false };
  else all.unshift(stamped);
  await writeChess(all);
  return all.filter((g) => g && !g.removed);
}

export async function removeChessResult(id) {
  await cloudBoot();
  const all = (Array.isArray(cacheGet(STORE_KEYS.chessResults)) ? cacheGet(STORE_KEYS.chessResults) : []).map((g) => {
    if (!g || g.id !== id) return g;
    return { ...g, removed: true, updatedAt: Date.now() };
  });
  await writeChess(all);
  return all.filter((g) => g && !g.removed);
}
