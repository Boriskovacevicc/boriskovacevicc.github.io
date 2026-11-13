import "./shared/status.js";

const games = (Array.isArray(window.BOKI_GAMES) ? window.BOKI_GAMES : []).filter((game) => game && game.name && game.href && !/^(?:[a-z]+:|\/\/)/i.test(game.href));

function icon(game) {
  const src = String(game.icon || "").trim();
  if (/\.(?:svg|png|webp|jpe?g|gif)(?:$|\?)/i.test(src)) {
    const img = document.createElement("img");
    img.src = src;
    img.alt = "";
    return img;
  }
  const span = document.createElement("span");
  span.className = "emoji";
  span.textContent = src || "🎲";
  return span;
}

function fill(list, mode) {
  list.replaceChildren();
  games.forEach((game) => {
    const href = mode === "board" ? game.leaderboard : game.href;
    if (!href || /^(?:[a-z]+:|\/\/)/i.test(href)) return;
    const link = document.createElement("a");
    link.className = "item";
    link.href = href;
    const copy = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = game.name;
    copy.appendChild(title);
    if (game.description && mode === "play") {
      const small = document.createElement("small");
      small.textContent = game.description;
      copy.appendChild(small);
    } else if (mode === "board") {
      const small = document.createElement("small");
      small.textContent = "Family table";
      copy.appendChild(small);
    }
    link.append(icon(game), copy);
    list.appendChild(link);
  });
}

fill(document.getElementById("games-list"), "play");
fill(document.getElementById("boards-list"), "board");

const menus = [
  { btn: document.getElementById("games-btn"), panel: document.getElementById("games-panel") },
  { btn: document.getElementById("boards-btn"), panel: document.getElementById("boards-panel") },
];

function setOpen(menu, open) {
  menu.btn.setAttribute("aria-expanded", open ? "true" : "false");
  menu.panel.classList.toggle("open", open);
  menu.panel.inert = !open;
}

function closeAll() {
  menus.forEach((menu) => setOpen(menu, false));
}

menus.forEach((menu) => {
  menu.btn.addEventListener("click", () => {
    const willOpen = menu.btn.getAttribute("aria-expanded") !== "true";
    closeAll();
    if (!willOpen) return;
    setOpen(menu, true);
    const first = menu.panel.querySelector("a");
    if (first) first.focus();
  });
  menu.panel.addEventListener("keydown", (event) => {
    const links = [...menu.panel.querySelectorAll("a")];
    const index = links.indexOf(document.activeElement);
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(menu, false);
      menu.btn.focus();
    } else if (event.key === "ArrowDown") {
      event.preventDefault();
      (links[index + 1] || links[0])?.focus();
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (index <= 0) menu.btn.focus();
      else links[index - 1].focus();
    } else if (event.key === "Home") {
      event.preventDefault();
      links[0]?.focus();
    } else if (event.key === "End") {
      event.preventDefault();
      links[links.length - 1]?.focus();
    }
  });
});

document.addEventListener("pointerdown", (event) => {
  if (!document.getElementById("stack").contains(event.target)) closeAll();
});
document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  const open = menus.find((menu) => menu.btn.getAttribute("aria-expanded") === "true");
  if (!open) return;
  closeAll();
  if (!open.panel.contains(document.activeElement)) open.btn.focus();
});
