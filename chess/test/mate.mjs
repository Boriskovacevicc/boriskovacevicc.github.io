import { chromium } from '../node_modules/playwright-core/index.mjs';
const b = await chromium.launch({ executablePath: '/usr/bin/google-chrome', args: ['--no-sandbox'] });
const p = await (await b.newContext({ viewport: { width: 1366, height: 1024 } })).newPage();
await p.goto(process.env.BASE); await p.evaluate(() => localStorage.clear()); await p.reload();
await p.click('label:has(#optEval)'); await p.click('#startBtn');
await p.evaluate(() => { for (const [f,t] of [['f2','f3'],['e7','e5'],['g2','g4']]) window.__app.doMove(f,t); });
await p.waitForFunction(() => window.__lastEval && window.__lastEval.type === 'mate', null, { timeout: 15000 });
console.log('mate label:', await p.textContent('#evaltext'), 'bar white%:', await p.evaluate(() => document.getElementById('evalfill').style.height));
await b.close();
