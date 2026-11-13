# Boki Games

Games for Boris (Boki) and the family, played in the browser.

The site is [boriskovacevicc.github.io](https://boriskovacevicc.github.io). It is a plain folder of files, so nothing needs to be installed to play.

## Games

- **Boki Riki Tiki** — scorekeeper for the family card game (`riki-tiki/`)
- **Boki Tablice** — scorekeeper for the Serbian card game (`tablice/`)
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

Riki Tiki still keeps its own save under `rikki-tikki-v2` and still reads `rikki-tikki-v1`. Tablice keeps its save under `boki-tablice-v1`. Chess still keeps the game in progress under `boki-chess-v1`. Finished chess games are stored as `boki-chess-results-v1`. The shared name list is `boki-players-v1`. Leave those names as they are.

Those shared records also go to Firebase (project `boki-games`) so the family’s phones and iPads see the same names and leaderboards. Finished chess series are stored too (`boki-chess-series-v1`, collection `chessSeries`). Each device keeps a copy for when the internet is off, and sends it later. A small **Synced** / **Offline** label sits in the corner.

A name that contains “test”, such as Test 1 or Testing, is left off every leaderboard. Those games are still saved, and they do not change anyone else’s ranking.

Riki Tiki ranks by wins, then average points. Tablice ranks by wins, then win rate. A pairs win counts for both partners. Chess ranks by wins, then series wins, then win rate. Draws count as games and not as wins.

In-progress games stay on the device that started them.

Anonymous sign-in is on, and the live rules match `firestore.rules` in this repo. After a change to that file, publish it from the Firestore rules tab in project **boki-games**. No passwords. The site signs in quietly in the background. Analytics is not loaded.

The web config lives in `shared/store.config.js`. The API key there was checked against the project: a test note was written to Firestore and then deleted.

## Tablice

Two, three or four players. With four, the default is two pairs, and the scoreboard shows the two teams while all four names stay in the history. First to 101 is the usual target; three players start at 51. Either target can be chosen.

With two players, or four playing as pairs, typing one side’s card points fills the other side so the two boxes add up to 22. A final round, and Finish game, leave both boxes free. Three players and four individuals type every box.

Each round, enter the card points for each side. There are 22 card points. In a two-player or four-player game, the side with the most cards also gets 3, so a normal round adds up to 25, or 22 if that was a tie. Three players have no most-cards bonus. Tabla is an extra +1 for the player who made it (their team, in pairs) and is not part of the 22 or 25.

If the card points are short or long, the app asks before saving. It stays quiet when the round wins the game, when Final round is ticked, or when the round is already a final round: the 22 card points cannot be shared without someone reaching the target. That is when the room left under the target, added up across the sides, is less than 22. A score of 95–96 to 101 has room 5 + 4, so it is final. 99–66 has room 1 + 34, so it is not.

Finish game saves a partial round with no total check and ends the match when a side has reached the target. If nobody has, it leaves the round open and says so.

A side that ends a round on 90 or more in a 101 game (40 or more in a 51 game) cannot score more tablas. The line is the target minus 11. A side on 89 can still score tablas for that whole round.

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

You can also tap pieces to take them off before the game starts. Kings stay on. If a rook comes off, that side cannot castle with it. The game starts from that position. If colours swap in a series, the missing pieces stay with the same person.

## Piece styles, colours, clocks and series

Each player has a piece button on the start screen. The board can show two styles at once. The choice is saved with that player’s name. The sets are open drawings listed in `chess/LICENSES.md`. Neon and Woodland are recolours of Chessnut.

Under each name is White, Black or Random. Picking White for one person sets Black for the other. Random is decided when the game starts, and a short message says who has White.

The clock can be off, or a base time up to 120 minutes plus an increment up to 60 seconds. Advanced adds a second phase: after a chosen move, that player gets bonus minutes and a new increment. Pause freezes both clocks. Time does not pass while the game is paused or the page is closed, and the remaining time is in the saved game. Running out of time loses, unless the other player does not have enough material to force mate, in which case it is a draw.

Series is first to a score from 1 to 10, in halves. A win is 1, a draw is ½, a loss is 0. Colours swap each game. Hints, missing pieces and the clock stay with the player. The chess leaderboard has a Series column for series wins.

## Checks

```bash
node shared/store.test.mjs
node chess/test/balance.mjs
node tablice/test/score.mjs
node chess/test/clock.mjs
node chess/test/series.mjs
```

`chess/test/draws.mjs`, `chess/test/mate.mjs` and `chess/test/e2e.mjs` are the chess app’s own checks. Point `BASE` at the chess folder, for example `http://127.0.0.1:8765/chess/`.
