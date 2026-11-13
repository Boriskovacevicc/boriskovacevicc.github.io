import { loadRiki, loadTablice, listChessResults, listChessSeries } from "../shared/store.js";
import { rikiStandings, chessStandings, tabliceStandings } from "../shared/standings.js";
import "../shared/status.js";

const kind = document.body.dataset.board;
const card = document.getElementById("card");

function cell(tag, text) {
  const el = document.createElement(tag);
  el.textContent = text;
  return el;
}

function render(headers, rows) {
  card.replaceChildren();
  if (!rows.length) {
    const p = document.createElement("p");
    p.className = "empty";
    p.textContent = "No finished games yet.";
    card.appendChild(p);
    return;
  }
  const table = document.createElement("table");
  const head = document.createElement("tr");
  headers.forEach((label) => head.appendChild(cell("th", label)));
  const thead = document.createElement("thead");
  thead.appendChild(head);
  const body = document.createElement("tbody");
  rows.forEach((row) => {
    const tr = document.createElement("tr");
    row.forEach((value) => tr.appendChild(cell("td", value)));
    body.appendChild(tr);
  });
  table.append(thead, body);
  card.appendChild(table);
}

if (kind === "tablice") {
  const data = await loadTablice();
  const rows = tabliceStandings(data && data.matches);
  render(["", "Player", "Wins", "Games", "Win %", "Avg / round", "Tablas"], rows.map((row, index) => [
    String(index + 1),
    row.name,
    String(row.wins),
    String(row.games),
    row.games ? Math.round(row.rate * 100) + "%" : "–",
    row.rounds ? (Math.round(row.avg * 10) / 10).toString() : "–",
    String(row.tablas),
  ]));
} else if (kind === "chess") {
  const rows = chessStandings(await listChessResults(), await listChessSeries());
  render(["", "Player", "Wins", "Series", "Win rate", "Games"], rows.map((row, index) => [
    String(index + 1),
    row.name,
    String(row.wins),
    String(row.seriesWins || 0),
    row.games ? Math.round(row.rate * 100) + "%" : "–",
    String(row.games),
  ]));
} else {
  const data = await loadRiki();
  const rows = rikiStandings(data && data.matches);
  render(["", "Player", "Wins", "Average", "Matches"], rows.map((row, index) => [
    String(index + 1),
    row.name,
    String(row.wins),
    row.played ? (Math.round(row.avg * 10) / 10).toString() : "–",
    String(row.played),
  ]));
}
