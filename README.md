# Boki Games

Games for Boris (Boki) and the family, played in the browser.

The site is [boriskovacevicc.github.io](https://boriskovacevicc.github.io). It is a plain folder of files, so nothing needs to be installed to play.

## Games

- **Boki Riki Tiki** — scorekeeper for the family card game (`riki-tiki/`)
- **Boki Chess** — pass-and-play chess for two (`chess/`). The knight drawing is by Colin M.L. Burnett, GPLv2+ (see `chess/LICENSES.md`).

The home page has two buttons. **Games** opens a game. **Leaderboards** opens that game’s table.

## Adding a game

The home page reads one list: `games.js`.

1. Create a folder next to `index.html`, for example `memory/`, with the game at `memory/index.html`. Keep links inside the game relative (they should not start with `/`).
2. On the game’s start screen, add a small link back here, in the Baloo 2 font, and leave it off the screen where people are actually playing:

   ```html
   <link rel="stylesheet" href="../shared/fonts.css" />
   <a class="hub-link" href="../">Boki Games</a>
   ```

3. Open `games.js` and add an entry to `BOKI_GAMES`. `icon` can be a file such as `icons/memory.svg`, or a single emoji such as `"🎲"`. `leaderboard` is the page that shows its table.

   ```js
   {
     name: "Memory",
     description: "A matching game for the little ones.",
     href: "memory/",
     leaderboard: "leaderboards/memory.html",
     icon: "🎲",
   },
   ```

4. Put the change on the `main` branch. The website updates on its own a minute or two later.

GitHub Pages is already turned on (branch `main`, folder `/`). The empty `.nojekyll` file tells Pages to serve every file as it is, including the chess engine.

## Names, scores and sync

Names typed in any game are remembered. The example name used in the checks is **Boris Kovacevic**.

Riki Tiki still keeps its own save under `rikki-tikki-v2` and still reads `rikki-tikki-v1`. Chess still keeps the game in progress under `boki-chess-v1`. Finished chess games are stored as `boki-chess-results-v1`. The shared name list is `boki-players-v1`. Leave those names as they are.

Those three shared records also go to Firebase (project `boki-games`) so the family’s phones and iPads see the same names and leaderboards. Each device keeps a copy for when the internet is off, and sends it later. A small **Synced** / **Offline** label sits in the corner.

Riki Tiki ranks by wins, then average points. Chess ranks by wins, then win rate. Draws count as games and not as wins.

In-progress games stay on the device that started them.

### What Boris needs to do in Firebase

The database was created in test mode, which switches itself off after about 30 days. Before that, do these steps or the games will keep working on one device but stop sharing:

1. Open [the Firebase console](https://console.firebase.google.com/) and the project **boki-games**.
2. In the left menu, click **Build**, then **Authentication**. If you see **Get started**, click it.
3. Open the **Sign-in method** tab. Click **Anonymous**. Turn the switch on. Click **Save**.
4. In the left menu, click **Firestore Database**, then the **Rules** tab.
5. Select all the text in the box, delete it, and paste the whole of the file `firestore.rules` from this project. Click **Publish**.

No passwords. The site signs in quietly in the background. Analytics is not loaded.

The web config lives in `shared/store.config.js`. The API key there was checked against the project: a test note was written to Firestore and then deleted.

## Chess balancing

On the chess start screen each player can type a chess.com rating. It is remembered with their name and filled in next time.

When both ratings are filled in, pick **Hints only**, **Piece odds only**, or **Both**. The sliders update, and you can still change them before **Start game**. Hint sliders go from 0 to 30.

Hints only, where the gap is the higher rating minus the lower one:

- Under 75: both players get 2 hints.
- Otherwise the lower-rated player gets `clamp(round(gap / 100) + 1, 1, 30)` hints. A gap of 100 gives 2, 500 gives 6, 1000 gives 11, and 2100 gives 22.
- The higher-rated player gets 2 hints if the gap is under 600, 1 if it is under 1200, and 0 after that.

Both does the same and then halves the lower-rated player’s hints, with a minimum of 1. An even game (gap under 75) is not halved.

Piece odds take material from the higher-rated player. The steps are in `chess/balance.js`:

| Gap | Removed |
| --- | --- |
| Under 100 | nothing |
| 100–199 | f-pawn |
| 200–349 | queen’s knight |
| 350–499 | queen’s rook |
| 500–699 | queen |
| 700–999 | queen and queen’s knight |
| 1000–1399 | queen and queen’s rook |
| 1400–1799 | queen’s rook, queen’s knight and f-pawn |
| 1800 and up | queen, queen’s rook, queen’s knight and f-pawn |

You can also tap pieces to take them off before the game starts. Kings stay on. If a rook comes off, that side cannot castle with it. The game starts from that position.

## Checks

```bash
node shared/store.test.mjs
node chess/test/balance.mjs
```

`chess/test/draws.mjs`, `chess/test/mate.mjs` and `chess/test/e2e.mjs` are the chess app’s own checks. Point `BASE` at the chess folder, for example `http://127.0.0.1:8765/chess/`.
