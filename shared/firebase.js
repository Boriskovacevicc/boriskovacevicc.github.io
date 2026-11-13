/**
 * Firebase adapter. Loaded only in the browser, from the official CDN.
 * Analytics is not imported.
 *
 * Firestore's persistent cache queues writes while offline and sends them
 * when the connection comes back.
 */
import { storeConfig } from "./store.config.js";

const SDK = "https://www.gstatic.com/firebasejs/11.10.0";

const listeners = new Set();
let status = { state: "local", detail: "" };
let starting = null;
let db = null;
let fs = null;

function emit(next) {
  status = next;
  listeners.forEach((fn) => {
    try { fn(status); } catch (e) { /* a status listener should not break sync */ }
  });
}

export function onSync(fn) {
  listeners.add(fn);
  fn(status);
  return () => listeners.delete(fn);
}

export function note(state, detail = "") {
  emit({ state, detail });
}

function clean(value) {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === "object") {
    const out = {};
    for (const [key, item] of Object.entries(value)) {
      if (item === undefined) continue;
      out[key] = clean(item);
    }
    return out;
  }
  return value;
}

function docId(id) {
  return String(id || "").replace(/\//g, "_").slice(0, 700);
}

export function start() {
  if (starting) return starting;
  if (typeof window === "undefined") {
    starting = Promise.resolve(false);
    return starting;
  }
  starting = boot().catch((error) => {
    note("offline", error && error.code ? error.code : "offline");
    starting = null;
    return false;
  });
  return starting;
}

async function boot() {
  note("syncing");
  const cfg = storeConfig.firebase || {};
  const { initializeApp, getApps } = await import(`${SDK}/firebase-app.js`);
  const { getAuth, signInAnonymously } = await import(`${SDK}/firebase-auth.js`);
  fs = await import(`${SDK}/firebase-firestore.js`);
  const app = getApps().length ? getApps()[0] : initializeApp({
    apiKey: cfg.apiKey,
    authDomain: cfg.authDomain,
    projectId: cfg.projectId,
    storageBucket: cfg.storageBucket,
    messagingSenderId: cfg.messagingSenderId,
    appId: cfg.appId,
  });
  const auth = getAuth(app);
  try {
    db = fs.initializeFirestore(app, {
      localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }),
    });
  } catch (e) {
    try {
      db = fs.initializeFirestore(app, { localCache: fs.persistentLocalCache() });
    } catch (err) {
      db = fs.getFirestore(app);
    }
  }
  try {
    await signInAnonymously(auth);
  } catch (error) {
    // Test-mode rules still allow access until Boris pastes the locked rules.
    // After that, Anonymous sign-in has to be on or cloud writes are skipped.
    note("offline", error && error.code ? error.code : "auth");
  }
  fs.onSnapshotsInSync(db, () => {
    note(navigator.onLine ? "synced" : "offline");
  });
  window.addEventListener("online", () => note("syncing"));
  window.addEventListener("offline", () => note("offline"));
  return true;
}

async function ready() {
  const ok = await start();
  if (!ok || !db || !fs) throw new Error("cloud unavailable");
  return true;
}

async function readAll(name) {
  await ready();
  const snap = await fs.getDocs(fs.collection(db, name));
  const rows = [];
  snap.forEach((item) => rows.push(item.data()));
  return rows;
}

async function put(name, id, data) {
  await ready();
  const safeId = docId(id);
  if (!safeId) return;
  const payload = clean({ ...data, updatedAt: data.updatedAt || Date.now() });
  await fs.setDoc(fs.doc(db, name, safeId), payload, { merge: true });
}

export async function pullPlayers() {
  return readAll("players");
}
export async function pushPlayer(player) {
  if (!player || !player.nameKey) return;
  await put("players", player.nameKey, player);
}

export async function pullRikiProfiles() {
  return readAll("rikiProfiles");
}
export async function pullRikiMatches() {
  return readAll("rikiMatches");
}
export async function pushProfile(profile) {
  if (!profile || !profile.id) return;
  await put("rikiProfiles", profile.id, profile);
}
export async function pushMatch(match) {
  if (!match || !match.id) return;
  await put("rikiMatches", match.id, match);
}

export async function pullChessResults() {
  return readAll("chessResults");
}
export async function pushChessResult(game) {
  if (!game || !game.id) return;
  await put("chessResults", game.id, game);
}

export async function pullChessSeries() {
  return readAll("chessSeries");
}
export async function pushChessSeries(row) {
  if (!row || !row.id) return;
  await put("chessSeries", row.id, row);
}

export async function pullTabliceProfiles() {
  return readAll("tabliceProfiles");
}
export async function pullTabliceMatches() {
  return readAll("tabliceMatches");
}
export async function pushTabliceProfile(profile) {
  if (!profile || !profile.id) return;
  await put("tabliceProfiles", profile.id, profile);
}
export async function pushTabliceMatch(match) {
  if (!match || !match.id) return;
  await put("tabliceMatches", match.id, match);
}

/** Used by the live check. Writes a diagnostics doc and deletes it. */
export async function probeDiagnostics(id) {
  await ready();
  const ref = fs.doc(db, "diagnostics", docId(id));
  await fs.setDoc(ref, { note: "cursor check", at: Date.now() });
  const snap = await fs.getDoc(ref);
  const found = snap.exists();
  await fs.deleteDoc(ref);
  return found;
}
