// Headless end-to-end test of the actual page: real index.html, real app.js,
// real engine — only the Worker is swapped for an in-process stand-in that
// routes through the same handler the browser worker uses.
import { test, assert, eq } from './run.js';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* optional dev dependency */ }

let bootCount = 0;
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

// app.js resolves `console` to the global object, not dom.window.console, so
// patching the jsdom window would capture nothing. Install one real sink.
let sink = [];
const realConsoleError = console.error;
console.error = (...args) => sink.push(args.map((a) => (a instanceof Error ? a.message : String(a))).join(' '));
process.on('unhandledRejection', (e) => sink.push(`unhandled rejection: ${e?.message ?? e}`));
process.on('uncaughtException', (e) => sink.push(`uncaught: ${e?.message ?? e}`));

async function waitFor(fn, label, timeoutMs = 30000, onTick = null) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (fn()) return true;
    if (onTick) await onTick();
    await tick(10);
  }
  throw new Error(`timed out waiting for: ${label}`);
}

/**
 * Play a hinted move if the table is waiting on the human. Whoever leads the
 * first trick is random, so any test that waits on the opponents has to keep
 * the game from blocking on us.
 */
function unblock($) {
  return async () => {
    if ($('turn').textContent !== 'Your turn' || $('play').disabled === false) return;
    $('hint').click();
    await tick(400);
    if (!$('play').disabled) { $('play').click(); await tick(50); }
  };
}

async function boot() {
  const { handle } = await import('../src/engine-api.js');
  const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  const errors = [];
  sink = errors;
  const dom = new JSDOM(html, { url: 'http://localhost:8765/', pretendToBeVisual: true });

  class FakeWorker {
    constructor() { this.onmessage = null; this.onerror = null; }
    postMessage(data) {
      // Emulate the real boundary: everything must survive serialisation.
      const msg = JSON.parse(JSON.stringify(data));
      let reply;
      try {
        // Keep the UI test quick; engine strength is covered by bench.js.
        const result = handle({ ...msg, opts: { samples: 2, limit: 4, timeBudgetMs: 600 } });
        reply = { id: msg.id, ok: true, result: JSON.parse(JSON.stringify(result)) };
      } catch (err) {
        errors.push(err);
        reply = { id: msg.id, ok: false, error: err.message };
      }
      setTimeout(() => this.onmessage?.({ data: reply }), 0);
    }
    terminate() {}
  }

  globalThis.window = dom.window;
  globalThis.document = dom.window.document;
  globalThis.Worker = FakeWorker;
  dom.window.document.getElementById('strength').value = 'fast';
  // app.js is a singleton module; the query string gives each test a fresh one.
  await import(`../app.js?boot=${++bootCount}`);
  return { dom, errors, $: (id) => dom.window.document.getElementById(id) };
}

if (!JSDOM) {
  test('UI end-to-end (skipped: run `npm install --no-save jsdom` to enable)', () => {});
} else {
  test('the page boots, deals a hand, and wires up the table', async () => {
    const { $, errors } = await boot();
    await waitFor(() => $('hand').querySelectorAll('.card').length > 0, 'the hand to render');
    eq($('hand').querySelectorAll('.card').length, 27, 'you are dealt 27 cards');
    eq($('deal').textContent, '1');
    assert($('wild-note').textContent.includes('wild'), 'the wildcard is named in the header');
    for (const seat of [0, 1, 2, 3]) assert($(`seat-${seat}`).textContent.length > 0, `seat ${seat} rendered`);
    eq(errors.length, 0, `console errors: ${errors.join(' | ')}`);
  });

  test('hint selects a legal move and Play sends it, and the coach reviews it', async () => {
    const { $, errors } = await boot();
    await waitFor(() => $('turn').textContent === 'Your turn' && !$('hand').classList.contains('locked'),
      'your turn', 90000);

    $('hint').click();
    await waitFor(() => $('coachbody').querySelector('.headline'), 'the hint to come back', 30000);

    const picked = $('hand').querySelectorAll('.sel').length;
    const before = $('hand').querySelectorAll('.card').length;
    if (picked > 0) {
      assert(!$('play').disabled, 'a hinted selection is playable');
      assert($('selinfo').textContent.startsWith('Plays as'), `selinfo said: ${$('selinfo').textContent}`);
      $('play').click();
      await waitFor(() => $('hand').querySelectorAll('.card').length === before - picked, 'the cards to leave your hand');
    } else {
      // The engine is entitled to recommend passing; that is still a coached move.
      assert($('coachbody').textContent.includes('pass'), 'a hint with no cards must be a recommendation to pass');
      assert(!$('pass').disabled, 'and passing must actually be available');
      $('pass').click();
    }
    await waitFor(() => $('coachbody').querySelector('.verdict'), 'the coach verdict', 30000);

    const verdict = $('coachbody').querySelector('.verdict').textContent;
    assert(['Best move', 'Good', 'Fine', 'Inaccuracy', 'Mistake', 'Blunder'].includes(verdict),
      `unexpected verdict: ${verdict}`);
    assert($('coachbody').querySelectorAll('.reasons li').length > 0, 'the coach gave reasons');
    assert($('coachbody').querySelectorAll('.line').length > 0, 'the engine ranking is shown');
    assert($('accuracy').textContent.includes('best'), 'the running accuracy updated');
    eq(errors.length, 0, `console errors: ${errors.join(' | ')}`);
  });

  test('clicking cards toggles selection, and the Play button follows the rules', async () => {
    const { $ } = await boot();
    await waitFor(() => $('turn').textContent === 'Your turn' && !$('hand').classList.contains('locked'),
      'your turn', 90000);
    const freeLead = $('trick-label').textContent.startsWith('Free lead');

    // The hand re-renders on every click, so always re-query by index.
    const at = (i) => $('hand').querySelectorAll('.card')[i];
    at(0).click();
    await tick();
    assert(at(0).classList.contains('sel'), 'the clicked card is selected');

    if (freeLead) {
      assert(!$('play').disabled, 'any single card is a legal free lead');
      assert($('selinfo').textContent.startsWith('Plays as'), $('selinfo').textContent);
    } else {
      const info = $('selinfo').textContent;
      assert($('play').disabled ? info.length > 0 : info.startsWith('Plays as'),
        `a blocked selection must say why, got: "${info}"`);
    }

    at(0).click();
    await tick();
    assert(!at(0).classList.contains('sel'), 'clicking again deselects');

    at(0).click();
    at(1).click();
    await tick();
    eq($('hand').querySelectorAll('.sel').length, 2, 'two cards selected');
    const info = $('selinfo').textContent;
    assert(info.startsWith('Plays as') || $('play').disabled,
      `an unplayable pair must block Play, got: "${info}"`);

    $('clear').click();
    await tick();
    eq($('hand').querySelectorAll('.sel').length, 0, 'Clear deselects everything');
    assert($('play').disabled, 'and Play is disabled with nothing selected');
  });

  test('restarting while a bot is thinking does not corrupt the game', async () => {
    const { $, errors } = await boot();
    await waitFor(() => $('hand').querySelectorAll('.card').length > 0, 'the first deal');
    // Interrupt repeatedly, exactly as an impatient player would.
    for (let i = 0; i < 6; i++) { $('new-match').click(); await tick(35); }
    await tick(1200);
    eq(errors.length, 0, `console errors: ${errors.join(' | ')}`);
    eq($('hand').querySelectorAll('.card').length, 27, 'a clean 27-card hand');
    eq($('deal').textContent, '1', 'back to deal 1');
    const headers = [...$('log').children].filter((li) => /— Deal 1,/.test(li.textContent));
    eq(headers.length, 1, 'the log was reset on restart, not appended to six times over');
  });

  test('the opponents take their turns and the log fills in', async () => {
    const { $, errors } = await boot();
    await waitFor(() => $('log').children.length >= 3, 'the table log to fill', 90000, unblock($));
    const text = $('log').textContent;
    assert(/plays|passes/.test(text), `log should record plays: ${text.slice(0, 200)}`);
    eq(errors.length, 0, `console errors: ${errors.join(' | ')}`);
  });
}
