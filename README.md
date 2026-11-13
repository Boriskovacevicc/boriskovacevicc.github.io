# Boki Games

Games for Boris (Boki) and the family, played in the browser.

The site is [boriskovacevicc.github.io](https://boriskovacevicc.github.io). It is a plain folder of files, so nothing needs to be installed to play.

## Games

- **Boki Riki Tiki** — scorekeeper for the family card game (`riki-tiki/`)
- **Boki Chess** — pass-and-play chess for two (`chess/`). The knight on the home page is the same drawing as in that app (Colin M.L. Burnett, GPLv2+; see `chess/LICENSES.md`).

## Adding a game

The home page reads one list: `games.js`. Add a block there, and put the game in its own folder.

1. Create a folder next to `index.html`, for example `memory/`, with the game at `memory/index.html`. Keep links inside the game relative (they should not start with `/`).
2. On the game’s start screen, add a small link back to this page, and leave it off the screen where people are actually playing:

   ```html
   <a href="../">← Games</a>
   ```

3. Open `games.js` and add an entry to `BOKI_GAMES`. There is a commented example at the bottom of the list. `icon` can be a file such as `icons/memory.svg`, or a single emoji such as `"🎲"`.

   ```js
   {
     name: "Memory",
     description: "A matching game for the little ones.",
     href: "memory/",
     icon: "🎲",
   },
   ```

4. Put the change on the `main` branch. The website updates on its own a minute or two later.

GitHub Pages is already turned on for this repository (branch `main`, folder `/`). No settings change is required. The empty `.nojekyll` file tells Pages to serve the files as they are.

Riki Tiki stores games in this browser under `rikki-tikki-v2` (and still reads `rikki-tikki-v1`). Chess uses `boki-chess-v1`. Leave those names as they are, or saved games disappear.
