import { chromium } from '../node_modules/playwright-core/index.mjs';
const BASE = process.env.BASE || 'http://localhost:8765/';
const OUT = '/workspace/chess-app/';
const results = []; const ok = (name, cond, extra = '') => { results.push(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  — ' + extra : ''}`); };
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const ctx = await b.newContext({ viewport: { width: 1366, height: 1024 }, hasTouch: true, deviceScaleFactor: 1 });
const p = await ctx.newPage();
const errors = []; p.on('pageerror', (e) => errors.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const center = async (sq) => { const r = await p.locator(`.sq[data-sq="${sq}"]`).boundingBox(); return [r.x + r.width / 2, r.y + r.height / 2]; };
const tap = async (sq) => { const [x, y] = await center(sq); await p.mouse.click(x, y); await p.waitForTimeout(120); };
const touch = async (sq) => { const [x, y] = await center(sq); await p.touchscreen.tap(x, y); await p.waitForTimeout(120); };
const move = async (a, c) => { await tap(a); await tap(c); await p.waitForTimeout(650); };
const fen = () => p.evaluate(() => window.__app.chess.fen());

await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
ok('setup screen visible', await p.isVisible('#setup'));
ok('eval toggle defaults OFF', !(await p.isChecked('#optEval')));
await p.fill('#nameW', 'Boris'); await p.fill('#nameB', 'Luka');
await p.locator('#hintsW').fill('3'); await p.locator('#hintsB').fill('2');
await p.screenshot({ path: OUT + 'screenshot-setup-landscape.png' });

// --- Game 1: eval OFF -> engine must not run for eval
await p.click('#startBtn'); await p.waitForTimeout(300);
ok('eval bar hidden when off', !(await p.isVisible('#evalbar')));
await move('e2', 'e4');
await p.waitForTimeout(1500);
const evalRan = await p.evaluate(() => !!window.__lastEval);
ok('no eval search when bar is off', !evalRan);
// hint still works with eval off
const hb = p.locator('#cardTop .hintbtn, #cardBottom .hintbtn').filter({ hasNot: p.locator('[disabled]') });
await p.locator('.hintbtn:not([disabled])').click();
await p.waitForFunction(() => window.__lastHint, null, { timeout: 20000 });
const h1 = await p.evaluate(() => ({ h: window.__lastHint, left: window.__app.S.hints, svg: document.querySelector('#arrows').innerHTML.length }));
ok('hint works with eval off (Black)', h1.h.color === 'b' && h1.left.b === 1 && h1.svg > 50, JSON.stringify(h1.h) + ' remaining b=' + h1.left.b);
ok('hint button disabled while hint shown', await p.locator('.hintbtn[data-c="b"]').isDisabled());
// in-game eval toggle on
await p.click('label:has(#gEval)'); await p.waitForFunction(() => window.__lastEval && window.__lastEval.depth >= 8, null, { timeout: 20000 });
ok('in-game eval toggle turns bar on + Stockfish responds', await p.isVisible('#evalbar'), JSON.stringify(await p.evaluate(() => window.__lastEval && { d: window.__lastEval.depth, t: window.__lastEval.type, v: window.__lastEval.value })));
await p.click('label:has(#gEval)'); await p.waitForTimeout(300);
ok('in-game eval toggle turns bar off', !(await p.isVisible('#evalbar')));

// --- Game 2: eval ON from setup
await p.evaluate(() => localStorage.clear()); await p.reload();
await p.fill('#nameW', 'Boris'); await p.fill('#nameB', 'Luka');
await p.locator('#hintsW').fill('3'); await p.locator('#hintsB').fill('2');
await p.click('label:has(#optEval)');
await p.click('#startBtn'); await p.waitForTimeout(300);
ok('eval bar shown when enabled at setup', await p.isVisible('#evalbar'));
ok('white to move: pieces upright', !(await p.evaluate(() => document.getElementById('board').classList.contains('prot'))));
await move('e2', 'e4');
const rot = await p.evaluate(() => getComputedStyle(document.querySelector('.pc img')).transform);
ok('after White moves, pieces rotate 180° for Black (table mode)', await p.evaluate(() => document.getElementById('board').classList.contains('prot')) && rot.startsWith('matrix(-1'), rot);
ok('Black card rotated to face Black', await p.evaluate(() => document.getElementById('cardTop').classList.contains('rot')));
await p.screenshot({ path: OUT + 'screenshot-flipped-black-to-move.png' });
await move('e7', 'e5');
ok('after Black moves, pieces back upright for White', !(await p.evaluate(() => document.getElementById('board').classList.contains('prot'))));
// drag move Nf3
{ const [x1, y1] = await center('g1'); const [x2, y2] = await center('f3');
  await p.mouse.move(x1, y1); await p.mouse.down(); await p.mouse.move(x1 + 20, y1 - 20, { steps: 3 }); await p.mouse.move(x2, y2, { steps: 8 }); await p.mouse.up(); await p.waitForTimeout(650); }
ok('drag-and-drop move (Nf3)', (await fen()).includes('5N2'));
// touch tap move
await touch('b8'); const dots = await p.locator('.mv').count(); await touch('c6'); await p.waitForTimeout(650);
ok('touch tap shows legal dots & moves (Nc6)', dots === 2 && (await fen()).startsWith('r1bqkbnr/pppp1ppp/2n5'), 'dots=' + dots);
await move('f1', 'c4'); await move('g8', 'f6');
// eval updates
const e0 = await p.evaluate(() => window.__lastEval);
await p.waitForTimeout(1500);
const evalState = await p.evaluate(() => ({ h: document.getElementById('evalfill').style.height, t: document.getElementById('evaltext').textContent, e: window.__lastEval, fen: window.__app.chess.fen() }));
ok('eval bar updates from Stockfish (White perspective)', evalState.e && evalState.e.fen === evalState.fen && evalState.h !== '50.0%' || (evalState.e && evalState.t !== '…'), `height=${evalState.h} label=${evalState.t} depth=${evalState.e && evalState.e.depth}`);
// hint for White
const before = await p.evaluate(() => window.__app.S.hints.w);
await p.evaluate(() => { window.__lastHint = null; });
await p.locator('.hintbtn[data-c="w"]').click();
await p.waitForFunction(() => window.__lastHint, null, { timeout: 20000 });
const after = await p.evaluate(() => ({ w: window.__app.S.hints.w, h: window.__lastHint, label: document.querySelector('.hintbtn[data-c="w"] .cnt').textContent }));
ok('White hint decrements 3→2 and shows arrow', before === 3 && after.w === 2 && after.label === '2' && (await p.locator('#arrows polygon').count()) === 1, `best=${after.h.from}-${after.h.to}`);
ok('Black hint button disabled on White\'s turn', await p.locator('.hintbtn[data-c="b"]').isDisabled());
await p.waitForTimeout(600);
await p.screenshot({ path: OUT + 'screenshot-midgame-eval-hint.png' });
// portrait
await p.setViewportSize({ width: 1024, height: 1366 }); await p.waitForTimeout(500);
await p.screenshot({ path: OUT + 'screenshot-midgame-portrait.png' });
await p.setViewportSize({ width: 1366, height: 1024 }); await p.waitForTimeout(300);
// play hinted move, then undo with confirmation
await move(after.h.from, after.h.to);
ok('hint arrow cleared after move', (await p.locator('#arrows polygon').count()) === 0);
const n1 = await p.evaluate(() => window.__app.S.moves.length);
await p.click('#undoBtn'); ok('undo asks for confirmation', await p.isVisible('#modal'));
await p.click('#mBtns button.danger'); await p.waitForTimeout(600);
ok('undo takes back one move', (await p.evaluate(() => window.__app.S.moves.length)) === n1 - 1);
// autosave + reload
const fBefore = await fen(); await p.reload(); await p.waitForTimeout(500);
ok('autosave restores game after reload', (await fen()) === fBefore && await p.isVisible('#game'));
ok('move list shows SAN', (await p.textContent('#moves')).includes('Nf3'));

// --- Promotion
await p.evaluate(() => { localStorage.clear(); }); await p.reload();
await p.click('#startBtn'); await p.waitForTimeout(200);
for (const [a, c] of [['h2','h4'],['g7','g5'],['h4','g5'],['h7','h5'],['g5','g6'],['g8','f6'],['g6','g7'],['h8','g8']]) await move(a, c);
await tap('g7'); await tap('f8'); await p.waitForTimeout(200);
ok('promotion picker appears', await p.isVisible('#promo'));
await p.screenshot({ path: OUT + 'screenshot-promotion.png' });
await p.click('#promo button[data-t="n"]'); await p.waitForTimeout(600);
ok('underpromotion to knight works', (await p.evaluate(() => window.__app.chess.get('f8'))).type === 'n');

// --- Checkmate (fool's mate) + stalemate/draw detection by chess.js
await p.evaluate(() => { localStorage.clear(); }); await p.reload();
await p.click('#startBtn'); await p.waitForTimeout(200);
await move('f2', 'f3'); await move('e7', 'e5'); await move('g2', 'g4'); await move('d8', 'h4');
await p.waitForTimeout(800);
const mt = await p.textContent('#mTitle').catch(() => '');
ok('checkmate detected + game-over dialog', (await p.isVisible('#modal')) && mt.includes('Checkmate'), mt);
ok('king in check highlighted', (await p.locator('.sq.check').count()) === 1);
await p.screenshot({ path: OUT + 'screenshot-checkmate.png' });

// --- Pass-the-iPad style rotates whole board
await p.evaluate(() => { localStorage.clear(); }); await p.reload();
await p.click('#flipStyle button[data-v="pass"]'); await p.click('#startBtn'); await p.waitForTimeout(200);
await move('d2', 'd4');
ok('pass mode rotates whole board for Black', await p.evaluate(() => document.getElementById('stage').classList.contains('rot')));
// auto-flip off
await p.click('label:has(#gFlip)'); await p.waitForTimeout(600);
ok('auto-flip toggle off keeps White orientation', !(await p.evaluate(() => document.getElementById('stage').classList.contains('rot') || document.getElementById('board').classList.contains('prot'))));

// portrait setup screenshot
await p.evaluate(() => { localStorage.clear(); }); await p.setViewportSize({ width: 1024, height: 1366 }); await p.reload(); await p.waitForTimeout(300);
await p.screenshot({ path: OUT + 'screenshot-setup-portrait.png' });

ok('no JS errors', errors.length === 0, errors.join(' | '));
console.log(results.join('\n'));
await b.close();
