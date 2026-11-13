import "../shared/status.js";
import { loadTablice, saveTablice, listPlayers, rememberPlayer, nameKey, normaliseName } from "../shared/store.js";
import { isTestName } from "../shared/standings.js";
import {
  CARD_POINTS, defaultTarget, dealerOrder, dealerPlayer, makeSides, hasMostCards, bonusPoints, cardTotal, expectedCardTotal,
  project, lockedSides, outcome, checkRound, winningRound, forcedFinal, finishDecision,
} from "./score.js";

const $ = (id) => document.getElementById(id);
const screens = ["setup", "game", "results", "history", "profile"];

let setupCount = 4;
let setupMode = "pairs";
let setupTarget = 101;
let targetTouched = false;
let firstDealer = 0;
let seats = Array.from({ length: 4 }, () => ({ name: "", profileId: null }));
let profiles = [];
let matches = [];
let game = null;
let sharedPlayers = [];
let reviewing = false;
let shownRows = -1;
let profileId = null;
let pendingAnyway = null;

function uid() {
  return "tb_" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}
function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}
function clamp(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(99, n);
}
function setScreen(name) {
  screens.forEach((id) => $("screen-" + id).classList.toggle("active", id === name));
}
function snapshot() {
  return { version: 1, setupCount, setupMode, setupTarget, targetTouched, firstDealer, seats, profiles, matches, game };
}
function save() {
  saveTablice(snapshot()).catch(() => {});
}
function playerCount() {
  return game ? game.players.length : setupCount;
}
function modeOf(source = game) {
  if (!source) return setupCount === 4 ? setupMode : "solo";
  return source.players.length === 4 ? source.mode : "solo";
}
function sidesOf(source = game) {
  const names = source.players.map((player) => player.name);
  return makeSides(names, modeOf(source));
}
function emptyDraft(source = game) {
  const sides = sidesOf(source);
  const count = source.players.length;
  return {
    cards: sides.map(() => 0),
    most: hasMostCards(count) ? "unset" : "tie",
    tablas: source.players.map(() => 0),
    finalRound: false,
  };
}
function priorRounds() {
  if (game.editing == null) return game.rounds;
  return game.rounds.slice(0, game.editing);
}
function totalsBefore() {
  const sides = sidesOf();
  const prior = priorRounds();
  if (!prior.length) return sides.map(() => 0);
  return project(prior, sides, game.players.length, game.target).totals;
}
function running() {
  const projected = project(game.rounds, sidesOf(), game.players.length, game.target);
  return projected;
}

function applyPayload(data) {
  if (!data || typeof data !== "object") return;
  if (Number.isInteger(data.setupCount)) setupCount = Math.min(4, Math.max(2, data.setupCount));
  if (data.setupMode === "pairs" || data.setupMode === "solo") setupMode = data.setupMode;
  if (data.setupTarget === 51 || data.setupTarget === 101) setupTarget = data.setupTarget;
  targetTouched = !!data.targetTouched;
  if (Number.isInteger(data.firstDealer)) firstDealer = data.firstDealer;
  if (Array.isArray(data.seats)) {
    data.seats.slice(0, 4).forEach((seat, index) => {
      seats[index] = { name: (seat && seat.name) || "", profileId: (seat && seat.profileId) || null };
    });
  }
  profiles = Array.isArray(data.profiles) ? data.profiles.filter((p) => p && p.id && p.name) : [];
  matches = Array.isArray(data.matches) ? data.matches.filter((m) => m && m.id && Array.isArray(m.players)) : [];
  game = data.game && Array.isArray(data.game.players) && data.game.players.length >= 2 ? data.game : null;
  if (game && !game.draft) game.draft = emptyDraft();
}

async function load() {
  try {
    const data = await loadTablice();
    if (data) applyPayload(data);
  } catch (e) { /* local copy still works later */ }
  try {
    for (const profile of profiles) if (profile && profile.name) await rememberPlayer(profile.name);
    sharedPlayers = await listPlayers();
  } catch (e) { sharedPlayers = []; }
  fillNames();
  renderSetup();
  if (game && game.phase === "done") {
    setScreen("results");
    renderResults();
  }
}

function fillNames() {
  const list = $("boki-names");
  const names = new Map();
  profiles.forEach((profile) => names.set(nameKey(profile.name), profile.name));
  sharedPlayers.forEach((player) => { if (player && player.name) names.set(player.nameKey || nameKey(player.name), player.name); });
  list.replaceChildren();
  names.forEach((name) => {
    const option = document.createElement("option");
    option.value = name;
    list.appendChild(option);
  });
}

function renderSetup() {
  if (setupCount !== 4) setupMode = "solo";
  if (!targetTouched) setupTarget = defaultTarget(setupCount);
  if (firstDealer >= setupCount) firstDealer = 0;
  $("count-value").textContent = String(setupCount);
  $("count-minus").disabled = setupCount <= 2;
  $("count-plus").disabled = setupCount >= 4;
  $("count-meta").textContent = setupCount === 4 && setupMode === "pairs" ? "Two teams of two" : setupCount + " players";
  $("mode-wrap").hidden = setupCount !== 4;
  $("mode-row").querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", btn.dataset.mode === setupMode));
  $("target-row").querySelectorAll("button").forEach((btn) => btn.classList.toggle("on", Number(btn.dataset.target) === setupTarget));
  const fields = $("name-fields");
  fields.replaceChildren();
  for (let i = 0; i < setupCount; i += 1) {
    const row = document.createElement("label");
    row.className = "name-row";
    const caption = document.createElement("span");
    caption.textContent = seatCaption(i);
    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 32;
    input.placeholder = "Player " + (i + 1);
    input.setAttribute("list", "boki-names");
    input.autocomplete = "off";
    input.dataset.seat = String(i);
    input.value = seats[i].name;
    row.append(caption, input);
    fields.appendChild(row);
  }
  const dealer = $("dealer-wrap");
  dealer.replaceChildren();
  const label = document.createElement("div");
  label.className = "label";
  label.textContent = "Deals first";
  const row = document.createElement("div");
  row.className = "choice-row";
  for (let i = 0; i < setupCount; i += 1) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "mini" + (firstDealer === i ? " on" : "");
    btn.textContent = seats[i].name.trim() || "Player " + (i + 1);
    btn.addEventListener("click", () => { firstDealer = i; save(); renderSetup(); });
    row.appendChild(btn);
  }
  dealer.append(label, row);
  const order = dealerOrder(setupCount, setupCount === 4 ? setupMode : "solo");
  const start = Math.max(0, order.indexOf(firstDealer));
  const turned = order.slice(start).concat(order.slice(0, start));
  $("deal-help").textContent = "Dealer order: " + turned.map((index) => seats[index].name.trim() || "Player " + (index + 1)).join(" → ");
  $("resume-btn").hidden = !game;
}

function seatCaption(index) {
  if (setupCount === 4 && setupMode === "pairs") return (index < 2 ? "Team A" : "Team B") + " · " + ((index % 2) + 1);
  return "Player " + (index + 1);
}

function ensureProfile(index) {
  const typed = normaliseName(seats[index].name) || "Player " + (index + 1);
  let profile = profiles.find((item) => nameKey(item.name) === nameKey(typed));
  if (!profile) {
    profile = { id: uid(), name: typed, createdAt: new Date().toISOString() };
    profiles.push(profile);
  } else profile.name = typed;
  seats[index].name = profile.name;
  seats[index].profileId = profile.id;
  rememberPlayer(profile.name).catch(() => {});
  return profile;
}

function startGame() {
  const chosen = [];
  for (let i = 0; i < setupCount; i += 1) chosen.push(ensureProfile(i));
  const mode = setupCount === 4 ? setupMode : "solo";
  game = {
    players: chosen.map((profile) => ({ id: profile.id, name: profile.name })),
    mode,
    target: setupTarget,
    firstDealer,
    rounds: [],
    draft: null,
    editing: null,
    phase: "playing",
    matchId: null,
    endedAt: null,
    finishNote: "",
  };
  game.draft = emptyDraft();
  reviewing = false;
  shownRows = -1;
  save();
  fillNames();
  setScreen("game");
  renderGame();
}

function resumeGame() {
  if (!game) return;
  reviewing = false;
  if (game.phase === "done") {
    setScreen("results");
    renderResults();
    return;
  }
  setScreen("game");
  renderGame();
}

function confirmNew() {
  if (!game) {
    setScreen("setup");
    renderSetup();
    return;
  }
  $("confirm-modal").classList.add("open");
}

function twoCardSides() {
  return sidesOf().length === 2;
}
function roundIsFinal() {
  return forcedFinal(totalsBefore(), game.target) || !!(game.draft && game.draft.finalRound);
}
function canAutofill() {
  return !!(game && twoCardSides() && !roundIsFinal());
}
/** The field just edited sets the other side to 22 minus that number. */
function mirrorFrom(index) {
  if (!canAutofill()) return;
  const entered = Math.min(CARD_POINTS, clamp(game.draft.cards[index]));
  game.draft.cards[index] = entered;
  game.draft.cards[index === 0 ? 1 : 0] = CARD_POINTS - entered;
}

function readDraft() {
  if (!game) return;
  const root = $("action-card");
  root.querySelectorAll("[data-card]").forEach((input) => {
    game.draft.cards[Number(input.dataset.card)] = clamp(input.value);
  });
  root.querySelectorAll("[data-tabla]").forEach((input) => {
    game.draft.tablas[Number(input.dataset.tabla)] = clamp(input.value);
  });
  const box = root.querySelector("#final-round");
  if (box) game.draft.finalRound = box.disabled ? true : box.checked;
}

function roundIndex() {
  return game.editing == null ? game.rounds.length : game.editing;
}

function shortName(label) {
  const text = String(label || "");
  if (text.length <= 12) return text;
  if (text.includes(" & ")) return text.split(" & ").map((part) => part.slice(0, 5)).join(" & ");
  return text.slice(0, 10);
}
function sideTablaTotal(side) {
  return side.members.reduce((sum, index) => sum + (Number(game.draft.tablas[index]) || 0), 0);
}
function bumpSideTabla(sideIndex, delta) {
  const side = sidesOf()[sideIndex];
  if (!side) return;
  if (delta > 0) {
    const first = side.members[0];
    game.draft.tablas[first] = clamp((game.draft.tablas[first] || 0) + 1);
    return;
  }
  const who = [...side.members].reverse().find((index) => (game.draft.tablas[index] || 0) > 0);
  if (who == null) return;
  game.draft.tablas[who] = clamp(game.draft.tablas[who] - 1);
}
function roundSplit(round, sides) {
  const count = game.players.length;
  const most = hasMostCards(count) ? round.most : "tie";
  return sides.map((side, index) => {
    const cards = Number(round.cards && round.cards[index]) || 0;
    const bonus = most === index ? bonusPoints(count, most) : 0;
    const tablas = side.members.reduce((sum, player) => sum + (Number(round.tablas && round.tablas[player]) || 0), 0);
    return { shown: cards + bonus, tablas };
  });
}

function renderGame() {
  if (!game) return;
  if (game.phase === "done" && !reviewing && game.editing == null) {
    setScreen("results");
    renderResults();
    return;
  }
  setScreen("game");
  const sides = sidesOf();
  const before = totalsBefore();
  const count = game.players.length;
  const dealer = dealerPlayer(roundIndex(), count, modeOf(), game.firstDealer);
  const forced = forcedFinal(before, game.target);
  const state = running();
  const dealerSide = sides.findIndex((side) => side.members.includes(dealer));
  const roundLabel = game.editing != null ? "Editing " + (game.editing + 1) : "Round " + (game.rounds.length + 1);
  $("banner").innerHTML = "<b>" + roundLabel + "</b> · to " + game.target +
    " · <span class=\"dealer-dot\"></span>" + esc(game.players[dealer].name) +
    (state.history.length && outcome(state.totals, game.target).tie ? " · tied, keep playing" : "");
  $("dock").hidden = reviewing && game.editing == null;
  $("tabla-bar").hidden = reviewing && game.editing == null;
  renderBoard(sides, state, before, dealerSide);
  renderTablaBar(sides, before, dealerSide);
  if (reviewing && game.editing == null) {
    $("action-card").innerHTML = '<p class="help">Hold a round if you need to change it.</p>' +
      '<div class="action-buttons"><button type="button" class="btn btn-primary" data-act="back-results">Back to results</button>' +
      '<button type="button" class="btn btn-ghost" data-act="undo">Undo last round</button></div>';
    return;
  }
  renderEntry(sides, before, forced);
}

function renderBoard(sides, state, before, dealerSide) {
  const locks = lockedSides(before, game.target);
  let html = "<thead><tr><th class='rnd' rowspan='2'>Round</th>";
  sides.forEach((side, index) => {
    const mark = (index === dealerSide ? '<i class="ddot" title="Deals this round"></i>' : "") +
      (locks[index] ? '<i class="lock" title="Tablas locked">🔒</i>' : "");
    html += '<th colspan="2" title="' + esc(side.label) + '">' + mark + esc(shortName(side.label)) + "</th>";
  });
  html += "</tr><tr>";
  sides.forEach(() => { html += "<th>Pts</th><th>Tot</th>"; });
  html += "</tr></thead><tbody>";
  if (!game.rounds.length) {
    html += '<tr><td class="rnd">—</td><td class="empty-cell" colspan="' + (sides.length * 2) + '">Scores appear here</td></tr>';
  }
  game.rounds.forEach((round, index) => {
    const dealt = dealerPlayer(index, game.players.length, modeOf(), game.firstDealer);
    const dealtSide = sides.findIndex((side) => side.members.includes(dealt));
    const split = roundSplit(round, sides);
    const runningTotals = state.history[index] ? state.history[index].totals : [];
    html += '<tr data-round="' + index + '" title="Hold to edit. Dealer ' + esc(game.players[dealt].name) + '">';
    html += '<td class="rnd">' + (index + 1) + "</td>";
    split.forEach((cell, sideIndex) => {
      html += '<td class="pts">' + (sideIndex === dealtSide ? '<i class="ddot" title="Dealer"></i>' : "") + cell.shown + " (" + cell.tablas + ")</td>";
      html += '<td class="tot">' + (runningTotals[sideIndex] || 0) + "</td>";
    });
    html += "</tr>";
  });
  html += "</tbody>";
  $("score-table").innerHTML = html;
  const scroller = $("board-scroll");
  if (game.rounds.length !== shownRows) {
    shownRows = game.rounds.length;
    const pin = () => { scroller.scrollTop = scroller.scrollHeight; };
    pin();
    requestAnimationFrame(pin);
  }
}

function renderTablaBar(sides, before, dealerSide) {
  const locks = lockedSides(before, game.target);
  $("tabla-bar").style.setProperty("--sides", String(sides.length));
  let html = '<div class="round-spacer" aria-hidden="true"></div>';
  sides.forEach((side, index) => {
    const count = sideTablaTotal(side);
    const locked = !!locks[index];
    html += '<div class="tabla-slot">' +
      '<button type="button" class="tabla-btn" data-act="tabla-add" data-side="' + index + '"' + (locked ? " disabled" : "") +
      ' aria-label="Tabla for ' + esc(side.label) + '">' + (locked ? "🔒 Tabla" : "Tabla") +
      (count ? " +" + count : "") + "</button>" +
      (count && !locked ? '<button type="button" class="undo-mini" data-act="tabla-undo" data-side="' + index + '" aria-label="Undo tabla">↶</button>' : "") +
      "</div>";
  });
  $("tabla-bar").innerHTML = html;
}

function leaderIndexes(totals) {
  if (!totals.length || totals.every((score) => !score)) return [];
  const best = Math.max(...totals);
  return totals.map((score, index) => score === best ? index : -1).filter((index) => index >= 0);
}

function renderHistoryCard() {
  const sides = sidesOf();
  const state = running();
  let html = "<h3>Rounds</h3>";
  if (!game.rounds.length) html += '<p class="empty">No rounds yet.</p>';
  game.rounds.forEach((round, index) => {
    const dealer = dealerPlayer(index, game.players.length, modeOf(), game.firstDealer);
    const bits = sides.map((side, sideIndex) => esc(side.label) + " " + ((round.points && round.points[sideIndex]) || 0)).join(" · ");
    const totalBits = state.history[index] ? state.history[index].totals.map((score, sideIndex) => esc(sides[sideIndex].label.split(" & ")[0]) + " " + score).join(" · ") : "";
    html += '<button type="button" class="round-row" data-act="edit" data-round="' + index + '">' +
      '<span class="round-top"><b>Round ' + (index + 1) + "</b><span>Dealer " + esc(game.players[dealer].name) + "</span></span>" +
      '<span class="pts">' + bits + "</span>" +
      '<span class="help">Running ' + totalBits + (round.finalRound ? " · final" : "") + "</span></button>";
  });
  $("history-card").innerHTML = html;
}

function renderEntry(sides, before, forced) {
  const count = game.players.length;
  const draft = game.draft;
  const max = canAutofill() ? CARD_POINTS : 99;
  let html = '<div class="field-label">Round score</div><div class="score-grid" style="--sides:' + sides.length + '">';
  if (game.editing != null) html = '<p class="edit-line">Fixing round ' + (game.editing + 1) + ' <button type="button" data-act="cancel-edit">Cancel</button></p>' + html;
  sides.forEach((side, index) => {
    html += '<label><span title="' + esc(side.label) + '">' + esc(shortName(side.label)) + "</span>" +
      '<input data-card="' + index + '" inputmode="numeric" type="number" min="0" max="' + max + '" value="' + draft.cards[index] + '" aria-label="Card points for ' + esc(side.label) + '"></label>';
  });
  html += "</div>";
  if (hasMostCards(count)) {
    html += '<div class="field-label">Most cards</div><div class="most slim" role="group" aria-label="Most cards">';
    sides.forEach((side, index) => {
      html += '<button type="button" class="mini' + (draft.most === index ? " on" : "") + '" data-act="most" data-most="' + index + '">' + esc(shortName(side.label)) + "</button>";
    });
    html += '<button type="button" class="mini' + (draft.most === "tie" ? " on" : "") + '" data-act="most" data-most="tie">Tie</button></div>';
  }
  html += '<label class="final-row"><input type="checkbox" id="final-round"' + ((forced || draft.finalRound) ? " checked" : "") + (forced ? " disabled" : "") + "> Final round";
  if (forced) html += ' <span class="final-badge">Final round!</span>';
  html += "</label>";
  html += sumLine(draft, count, forced);
  if (game.finishNote) html += '<p class="note" id="finish-note">' + esc(game.finishNote) + "</p>";
  else html += '<p class="note" id="finish-note" hidden></p>';
  if (game.rounds.length) html += '<button type="button" class="text-btn" data-act="undo">Undo last round</button>';
  $("action-card").innerHTML = html;
}

function sumLine(draft, count, forced) {
  const most = hasMostCards(count) ? draft.most : "tie";
  if (forced || draft.finalRound) {
    const got = cardTotal(draft.cards, count, most === "unset" ? "tie" : most);
    return '<p class="sum ok" id="sum-line">Final round · ' + got + " card points</p>";
  }
  if (most === "unset") return '<p class="sum" id="sum-line">Pick most cards, or Tie.</p>';
  const got = cardTotal(draft.cards, count, most);
  const expected = expectedCardTotal(count, most);
  const ok = got === expected;
  return '<p class="sum ' + (ok ? "ok" : "bad") + '" id="sum-line">' + (ok ? "Card points " + got : got + " card points, needs " + expected) + "</p>";
}

function refreshSum() {
  const line = $("sum-line");
  if (!line || !game) return;
  const forced = forcedFinal(totalsBefore(), game.target);
  const html = sumLine(game.draft, game.players.length, forced);
  line.outerHTML = html;
}

function onActionClick(event) {
  const btn = event.target.closest("[data-act]");
  if (!btn || !game) return;
  if ($("action-card").querySelector("[data-card]")) readDraft();
  const act = btn.dataset.act;
  if (act === "tabla-add" || act === "tabla-undo") {
    bumpSideTabla(Number(btn.dataset.side), act === "tabla-add" ? 1 : -1);
    game.finishNote = "";
    renderTablaBar(sidesOf(), totalsBefore(), sidesOf().findIndex((side) => side.members.includes(dealerPlayer(roundIndex(), game.players.length, modeOf(), game.firstDealer))));
    return;
  } else if (act === "most") {
    game.draft.most = btn.dataset.most === "tie" ? "tie" : Number(btn.dataset.most);
    game.finishNote = "";
    renderGame();
  } else if (act === "save") saveRound();
  else if (act === "finish") finishGame();
  else if (act === "undo") undoLast();
  else if (act === "edit") beginEdit(Number(btn.dataset.round));
  else if (act === "cancel-edit") cancelEdit();
  else if (act === "back-results") { reviewing = false; setScreen("results"); renderResults(); }
}

function onActionInput(event) {
  if (!event.target.matches("[data-card], [data-tabla], #final-round")) return;
  const card = event.target.matches("[data-card]") ? Number(event.target.dataset.card) : -1;
  readDraft();
  if (card >= 0) {
    mirrorFrom(card);
    event.target.value = game.draft.cards[card];
    const other = card === 0 ? 1 : 0;
    const otherInput = document.querySelector('[data-card="' + other + '"]');
    if (otherInput && canAutofill()) otherInput.value = game.draft.cards[other];
  }
  game.finishNote = "";
  refreshSum();
}

function currentCheck(finalRound) {
  return checkRound({
    cards: game.draft.cards,
    most: game.draft.most,
    tablas: game.draft.tablas,
    sides: sidesOf(),
    playerCount: game.players.length,
    totalsBefore: totalsBefore(),
    target: game.target,
    finalRound,
  });
}

function saveRound() {
  readDraft();
  const forced = forcedFinal(totalsBefore(), game.target);
  const finalRound = forced || game.draft.finalRound;
  const check = currentCheck(finalRound);
  if (!check.warn) { commitRound(check, finalRound); return; }
  if (check.reason === "pick") {
    openWarn("Who had the most cards? Choose a side, or Tie.", () => {
      game.draft.most = "tie";
      const again = currentCheck(finalRound);
      if (again.warn) openWarn(sumMessage(again), () => commitRound(again, finalRound));
      else commitRound(again, finalRound);
    });
    return;
  }
  openWarn(sumMessage(check), () => commitRound(check, finalRound));
}

function sumMessage(check) {
  return "These card points add up to " + check.got + ", not " + check.expected + ". Tablas are extra, so they are not part of this check.";
}

function finishGame() {
  readDraft();
  const check = currentCheck(true);
  const decision = finishDecision(check, game.target);
  if (!decision.end) {
    game.finishNote = decision.note;
    renderGame();
    return;
  }
  game.draft.finalRound = true;
  commitRound(check, true);
}

function commitRound(check, finalRound) {
  const round = {
    cards: game.draft.cards.map(clamp),
    most: hasMostCards(game.players.length) ? game.draft.most : "tie",
    tablas: game.draft.tablas.map(clamp),
    finalRound: !!finalRound,
    points: check.points,
  };
  if (game.editing == null) game.rounds.push(round);
  else {
    game.rounds[game.editing] = round;
    game.editing = null;
  }
  const projected = project(game.rounds, sidesOf(), game.players.length, game.target);
  projected.history.forEach((item, index) => { game.rounds[index].points = item.points; });
  const wonAt = winningRound(projected.history, game.target);
  game.draft = emptyDraft();
  game.finishNote = "";
  reviewing = false;
  if (wonAt >= 0) {
    game.rounds = game.rounds.slice(0, wonAt + 1);
    game.phase = "done";
    game.endedAt = new Date().toISOString();
    upsertMatch(projected.history[wonAt].totals);
    save();
    setScreen("results");
    renderResults();
    return;
  }
  game.phase = "playing";
  if (outcome(projected.totals, game.target).tie) {
    game.finishNote = "It's a tie on " + game.target + ". Keep playing — the higher score wins.";
  }
  if (game.matchId) voidMatch(game.matchId);
  game.matchId = null;
  save();
  renderGame();
}

function upsertMatch(totals) {
  const sides = sidesOf();
  const result = outcome(totals, game.target);
  const winnerIds = result.winner == null ? [] : sides[result.winner].members.map((index) => game.players[index].id);
  const row = {
    id: game.matchId || uid(),
    endedAt: game.endedAt,
    target: game.target,
    mode: modeOf(),
    void: false,
    players: game.players,
    sides,
    rounds: game.rounds,
    totals,
    winnerIds,
    winnerNames: winnerIds.map((id) => (game.players.find((player) => player.id === id) || {}).name).filter(Boolean),
  };
  game.matchId = row.id;
  const index = matches.findIndex((match) => match.id === row.id);
  if (index >= 0) matches[index] = row;
  else matches.unshift(row);
}

function voidMatch(id) {
  const match = matches.find((item) => item.id === id);
  if (match) match.void = true;
}

function undoLast() {
  if (!game || !game.rounds.length) return;
  game.editing = null;
  game.rounds.pop();
  game.phase = "playing";
  game.draft = emptyDraft();
  game.finishNote = "";
  reviewing = false;
  if (game.matchId) voidMatch(game.matchId);
  game.matchId = null;
  game.endedAt = null;
  save();
  setScreen("game");
  renderGame();
}

function beginEdit(index) {
  if (!Number.isInteger(index) || !game.rounds[index]) return;
  reviewing = false;
  game.editing = index;
  const round = game.rounds[index];
  game.draft = {
    cards: round.cards.slice(),
    most: round.most,
    tablas: round.tablas.slice(),
    finalRound: !!round.finalRound,
  };
  game.finishNote = "";
  renderGame();
}

function cancelEdit() {
  game.editing = null;
  game.draft = emptyDraft();
  if (game.phase === "done") {
    setScreen("results");
    renderResults();
    return;
  }
  renderGame();
}

function renderResults() {
  if (!game) return;
  const sides = sidesOf();
  const state = running();
  const result = outcome(state.totals, game.target);
  const winner = result.winner == null ? null : sides[result.winner];
  let html = '<div class="trophy" aria-hidden="true">★</div><h2>Final results</h2>';
  html += '<p class="winner-name">' + esc(winner ? winner.label : "Tablice") + " wins!</p>";
  html += '<p>' + (winner ? "With " + state.totals[result.winner] + " points — congratulations." : "") + "</p>";
  html += "<ul class='rank-list'>";
  const order = state.totals.map((score, index) => ({ score, index })).sort((a, b) => b.score - a.score);
  order.forEach((row, place) => {
    html += '<li class="' + (row.index === result.winner ? "first" : "") + '"><span>' + (place + 1) + ". " + esc(sides[row.index].label) +
      "</span><b>" + row.score + "</b></li>";
  });
  html += "</ul>";
  html += '<div class="action-buttons"><button type="button" class="btn btn-ghost" id="review-board">Review the scoreboard</button>' +
    '<button type="button" class="btn btn-ghost" id="results-undo">Undo last round</button>' +
    '<button type="button" class="btn btn-primary" id="play-again">Play again</button></div>';
  $("results-card").innerHTML = html;
  $("review-board").addEventListener("click", () => { reviewing = true; renderGame(); });
  $("results-undo").addEventListener("click", undoLast);
  $("play-again").addEventListener("click", () => { game = null; save(); setScreen("setup"); renderSetup(); });
}

function renderHistory() {
  const box = $("history-list");
  const people = profiles.slice().sort((a, b) => a.name.localeCompare(b.name));
  let html = "<h3>Players</h3>";
  if (!people.length) html += '<p class="empty">No players yet.</p>';
  people.forEach((profile) => {
    if (isTestName(profile.name)) return;
    const stats = statsFor(profile.id);
    html += '<button type="button" class="player-item" data-profile="' + profile.id + '"><span>' + esc(profile.name) +
      "</span><span>" + stats.wins + " wins · " + stats.games + " games</span></button>";
  });
  html += "<h3>Matches</h3>";
  const rows = matches.filter((match) => !match.void);
  if (!rows.length) html += '<p class="empty">No finished games yet.</p>';
  rows.forEach((match) => {
    const line = (match.sides || []).map((side, index) => esc(side.label) + " " + ((match.totals && match.totals[index]) || 0)).join(" · ");
    html += '<button type="button" class="match-item" data-match="' + match.id + '"><span><b>' + esc((match.winnerNames || []).join(" & ") || "Game") +
      "</b><br><span class='help'>" + line + "</span></span><span>" + match.target + "</span></button>";
  });
  box.innerHTML = html;
  box.querySelectorAll("[data-profile]").forEach((btn) => btn.addEventListener("click", () => openProfile(btn.dataset.profile)));
  box.querySelectorAll("[data-match]").forEach((btn) => btn.addEventListener("click", () => openMatch(btn.dataset.match)));
}

function statsFor(id) {
  const played = matches.filter((match) => !match.void && !(match.players || []).some((player) => isTestName(player && player.name)) && (match.players || []).some((player) => player.id === id));
  let wins = 0;
  let points = 0;
  let rounds = 0;
  let tablas = 0;
  played.forEach((match) => {
    const index = match.players.findIndex((player) => player.id === id);
    if ((match.winnerIds || []).includes(id)) wins += 1;
    const side = (match.sides || []).findIndex((item) => (item.members || []).includes(index));
    (match.rounds || []).forEach((round) => {
      rounds += 1;
      if (side >= 0) points += Number(round.points && round.points[side]) || 0;
      tablas += Number(round.tablas && round.tablas[index]) || 0;
    });
  });
  return { games: played.length, wins, points, rounds, tablas, rate: played.length ? wins / played.length : 0, avg: rounds ? points / rounds : 0 };
}

function openProfile(id) {
  profileId = id;
  const profile = profiles.find((item) => item.id === id);
  if (!profile) return;
  const stats = statsFor(id);
  $("profile-card").innerHTML = "<h2>" + esc(profile.name) + "</h2>" +
    "<p>" + stats.wins + " wins · " + stats.games + " games · " + (stats.games ? Math.round(stats.rate * 100) + "%" : "—") + " win rate</p>" +
    "<p>Average " + (stats.rounds ? Math.round(stats.avg * 10) / 10 : "—") + " points a round · " + stats.tablas + " tablas</p>";
  setScreen("profile");
}

function openMatch(id) {
  const match = matches.find((item) => item.id === id && !item.void);
  if (!match) return;
  const sides = match.sides || [];
  const names = (match.winnerNames || []).join(" & ");
  let html = "<h2>" + esc(names || "Finished game") + " wins</h2>";
  html += "<p>First to " + match.target + "</p><ul class='rank-list'>";
  sides.forEach((side, index) => {
    html += "<li><span>" + esc(side.label) + "</span><b>" + ((match.totals && match.totals[index]) || 0) + "</b></li>";
  });
  html += "</ul>";
  (match.rounds || []).forEach((round, index) => {
    const bits = sides.map((side, sideIndex) => esc(side.label) + " " + ((round.points && round.points[sideIndex]) || 0)).join(" · ");
    html += "<p>" + (index + 1) + ". " + bits + "</p>";
  });
  html += '<button type="button" class="btn btn-ghost" id="past-back">Back</button>';
  $("history-list").innerHTML = html;
  $("past-back").addEventListener("click", renderHistory);
}

function openWarn(message, onAnyway) {
  $("warn-text").textContent = message;
  pendingAnyway = onAnyway;
  $("warn-modal").classList.add("open");
}
function closeWarn() {
  $("warn-modal").classList.remove("open");
  pendingAnyway = null;
}

$("count-minus").addEventListener("click", () => { setupCount = Math.max(2, setupCount - 1); setupTarget = defaultTarget(setupCount); targetTouched = false; save(); renderSetup(); });
$("count-plus").addEventListener("click", () => { setupCount = Math.min(4, setupCount + 1); setupTarget = defaultTarget(setupCount); targetTouched = false; save(); renderSetup(); });
$("mode-row").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-mode]");
  if (!btn) return;
  setupMode = btn.dataset.mode;
  save();
  renderSetup();
});
$("target-row").addEventListener("click", (event) => {
  const btn = event.target.closest("[data-target]");
  if (!btn) return;
  setupTarget = Number(btn.dataset.target);
  targetTouched = true;
  save();
  renderSetup();
});
$("name-fields").addEventListener("input", (event) => {
  const input = event.target.closest("[data-seat]");
  if (!input) return;
  const index = Number(input.dataset.seat);
  seats[index].name = input.value;
  seats[index].profileId = null;
  const buttons = $("dealer-wrap").querySelectorAll("button");
  if (buttons[index]) buttons[index].textContent = input.value.trim() || "Player " + (index + 1);
  const order = dealerOrder(setupCount, setupCount === 4 ? setupMode : "solo");
  const start = Math.max(0, order.indexOf(firstDealer));
  const turned = order.slice(start).concat(order.slice(0, start));
  $("deal-help").textContent = "Dealer order: " + turned.map((i) => seats[i].name.trim() || "Player " + (i + 1)).join(" → ");
  save();
});
$("start-btn").addEventListener("click", startGame);
$("resume-btn").addEventListener("click", resumeGame);
$("new-game-btn").addEventListener("click", confirmNew);
$("results-new").addEventListener("click", confirmNew);
$("confirm-yes").addEventListener("click", () => { $("confirm-modal").classList.remove("open"); game = null; save(); setScreen("setup"); renderSetup(); });
$("confirm-no").addEventListener("click", () => $("confirm-modal").classList.remove("open"));
$("goto-history").addEventListener("click", () => { setScreen("history"); renderHistory(); });
$("history-back").addEventListener("click", () => { setScreen("setup"); renderSetup(); });
$("profile-back").addEventListener("click", () => { setScreen("history"); renderHistory(); });
$("goto-help").addEventListener("click", () => $("help-modal").classList.add("open"));
$("game-help").addEventListener("click", () => $("help-modal").classList.add("open"));
$("help-close").addEventListener("click", () => $("help-modal").classList.remove("open"));
$("warn-fix").addEventListener("click", closeWarn);
$("warn-anyway").addEventListener("click", () => { const next = pendingAnyway; closeWarn(); if (next) next(); });
$("action-card").addEventListener("click", onActionClick);
$("tabla-bar").addEventListener("click", onActionClick);
$("dock").addEventListener("click", onActionClick);
$("action-card").addEventListener("input", onActionInput);
let holdTimer = 0;
let holdX = 0;
let holdY = 0;
function cancelHold() { clearTimeout(holdTimer); holdTimer = 0; }
$("board-scroll").addEventListener("pointerdown", (event) => {
  const row = event.target.closest("[data-round]");
  if (!row || !game) return;
  holdX = event.clientX;
  holdY = event.clientY;
  const index = Number(row.dataset.round);
  holdTimer = setTimeout(() => beginEdit(index), 550);
});
$("board-scroll").addEventListener("pointermove", (event) => {
  if (Math.hypot(event.clientX - holdX, event.clientY - holdY) > 8) cancelHold();
});
["pointerup", "pointercancel", "pointerleave"].forEach((type) => {
  $("board-scroll").addEventListener(type, cancelHold);
});

load();
