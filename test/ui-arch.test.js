// Tests for the view layer's moving parts: the store, the engine client's
// generation guard, and keyed DOM reconciliation.
import { test, assert, eq } from './run.js';
import { createStore } from '../ui/store.js';
import { EngineClient, StaleRequest } from '../ui/engine-client.js';

let JSDOM = null;
try { ({ JSDOM } = await import('jsdom')); } catch { /* optional */ }

class ScriptedWorker {
  constructor() { this.sent = []; this.onmessage = null; this.onerror = null; this.terminated = false; }
  postMessage(m) { this.sent.push(m); }
  terminate() { this.terminated = true; }
  reply(id, result) { this.onmessage?.({ data: { id, ok: true, result } }); }
  fail(id, error) { this.onmessage?.({ data: { id, ok: false, error } }); }
}

function clientWithSpies() {
  const workers = [];
  const engine = new EngineClient('worker.js', {
    createWorker: () => { const w = new ScriptedWorker(); workers.push(w); return w; },
  });
  return { engine, workers };
}

// ---------------------------------------------------------------- store

test('the store only notifies when something actually changed', () => {
  const store = createStore({ a: 1, version: 0 });
  let n = 0;
  store.subscribe(() => n++);
  store.set({ a: 1 });
  eq(n, 0, 'setting the same value is a no-op');
  store.set({ a: 2 });
  eq(n, 1);
  store.touch();
  eq(n, 2, 'touch always notifies');
  eq(store.get().version, 1);
});

test('a set made during a render is coalesced, not re-entered', () => {
  const store = createStore({ a: 0, version: 0 });
  const seen = [];
  let once = false;
  store.subscribe((s) => {
    seen.push(s.a);
    if (!once) { once = true; store.set({ a: 99 }); }  // would recurse if unguarded
  });
  store.set({ a: 1 });
  eq(seen, [1, 99], 'the nested change is applied after the first pass finishes');
});

// ---------------------------------------------------------------- engine client

test('requests resolve on the channel they were sent to', async () => {
  const { engine, workers } = clientWithSpies();
  eq(workers.length, 2, 'a table worker and a coach worker');
  const p = engine.request('table', 'bot', { seat: 1 });
  eq(workers[0].sent[0].cmd, 'bot');
  eq(workers[0].sent[0].seat, 1);
  eq(workers[1].sent.length, 0, 'the coach channel is untouched');
  workers[0].reply(workers[0].sent[0].id, { move: null });
  eq(await p, { move: null });
});

test('the coach channel does not queue behind the table channel', async () => {
  const { engine, workers } = clientWithSpies();
  const table = engine.request('table', 'bot', {});
  const coach = engine.request('coach', 'review', {});
  // Answer the coach first; the table request is still outstanding.
  workers[1].reply(workers[1].sent[0].id, 'review-done');
  eq(await coach, 'review-done', 'a slow bot turn cannot hold up a review');
  workers[0].reply(workers[0].sent[0].id, 'bot-done');
  eq(await table, 'bot-done');
});

test('reset cancels everything in flight and respawns the workers', async () => {
  const { engine, workers } = clientWithSpies();
  const p = engine.request('table', 'bot', {});
  let caught = null;
  p.catch((e) => { caught = e; });
  engine.reset();
  await Promise.resolve(); await Promise.resolve();
  assert(caught instanceof StaleRequest, 'the pending request was rejected');
  assert(EngineClient.isStale(caught), 'and is recognisable as stale');
  assert(workers[0].terminated && workers[1].terminated, 'old workers were terminated, not just ignored');
  eq(workers.length, 4, 'both channels were respawned');
});

test('a reply from a superseded generation is never delivered', async () => {
  const { engine, workers } = clientWithSpies();
  const p = engine.request('table', 'bot', {});
  let caught = null;
  p.catch((e) => { caught = e; });
  const { id } = workers[0].sent[0];
  engine.generation++;                       // as a new deal would do
  workers[0].reply(id, { move: 'stale move' });
  await Promise.resolve(); await Promise.resolve();
  assert(caught?.stale, 'the late answer was discarded rather than applied');
});

test('worker failures reject rather than hang', async () => {
  const { engine, workers } = clientWithSpies();
  const p = engine.request('coach', 'review', {});
  workers[1].fail(workers[1].sent[0].id, 'engine exploded');
  let msg = null;
  await p.catch((e) => { msg = e.message; });
  eq(msg, 'engine exploded');
});

// ---------------------------------------------------------------- DOM

if (JSDOM) {
  const { el, reconcile, text, toggle } = await import('../ui/dom.js');
  const { createHandView } = await import('../ui/views/hand.js');
  const { parseCards } = await import('../src/cards.js');

  function page() {
    const dom = new JSDOM('<div id="root"></div>');
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    return dom;
  }

  test('reconcile reorders without replacing elements', () => {
    const dom = page();
    const root = document.getElementById('root');
    const [a, b, c] = ['a', 'b', 'c'].map((t) => el('span', {}, t));
    reconcile(root, [a, b, c]);
    assert(root.children[0] === a && root.children[2] === c, 'initial order');
    reconcile(root, [c, a]);
    assert(root.children[0] === c && root.children[1] === a, 'same nodes, new order');
    eq(root.children.length, 2, 'dropped nodes are removed');
    reconcile(root, []);
    eq(root.children.length, 0);
  });

  test('text and toggle avoid pointless DOM writes', () => {
    page();
    const node = el('span', {}, 'hello');
    text(node, 'hello');
    eq(node.textContent, 'hello');
    text(node, 'bye');
    eq(node.textContent, 'bye');
    toggle(node, 'on', true);
    assert(node.classList.contains('on'));
    toggle(node, 'on', false);
    assert(!node.classList.contains('on'));
  });

  test('a card keeps one DOM node across redraws', () => {
    const dom = page();
    const root = document.getElementById('root');
    let toggled = null;
    const render = createHandView(root, { onToggle: (id) => { toggled = id; } });
    const cards = parseCards('SA HK C3 D9');

    render({ cards, level: 2, selected: new Set(), interactive: true });
    const nodes = [...root.children];
    eq(nodes.length, 4);

    render({ cards, level: 2, selected: new Set([cards[0].id]), interactive: true });
    assert(root.children[0] === nodes[0], 'the same element is reused, not rebuilt');
    assert(root.children[0].classList.contains('sel'), 'it just gained a class');
    eq(root.children[0].getAttribute('aria-pressed'), 'true');

    // Playing a card removes only that node; the rest keep their identity.
    render({ cards: cards.slice(1), level: 2, selected: new Set(), interactive: true });
    eq(root.children.length, 3);
    assert(root.children[0] === nodes[1], 'surviving cards were not recreated');
  });

  test('one delegated listener handles every card click', () => {
    const dom = page();
    const root = document.getElementById('root');
    let toggled = null;
    const render = createHandView(root, { onToggle: (id) => { toggled = id; } });
    const cards = parseCards('SA HK');
    render({ cards, level: 2, selected: new Set(), interactive: true });

    root.children[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    eq(toggled, cards[1].id, 'the click reached the controller');

    toggled = null;
    render({ cards, level: 2, selected: new Set(), interactive: false });
    root.children[0].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
    eq(toggled, null, 'clicks are ignored when it is not your turn');
  });

  test('a small joker is not shrunk by the size class', () => {
    const dom = page();
    const root = document.getElementById('root');
    const render = createHandView(root, { onToggle: () => {} });
    const cards = parseCards('sj bj S5');
    render({ cards, level: 2, selected: new Set(), interactive: true });
    const [small, big] = [root.children[0], root.children[1]];
    assert(small.classList.contains('joker'), 'it is a joker');
    assert(!small.classList.contains('small'), '"small" is the size class — it must not leak onto small jokers');
    assert(big.classList.contains('jbig'), 'the big joker is coloured via jbig');
  });

  test('the wildcard is marked, and only at the current level', () => {
    const dom = page();
    const root = document.getElementById('root');
    const render = createHandView(root, { onToggle: () => {} });
    const cards = parseCards('H5 S5');
    render({ cards, level: 5, selected: new Set(), interactive: true });
    assert(root.children[0].classList.contains('wild'), '♥5 is wild at level 5');
    assert(root.children[1].classList.contains('levelcard'), '♠5 is a level card, not wild');

    render({ cards, level: 7, selected: new Set(), interactive: true });
    assert(!root.children[0].classList.contains('wild'), 'and not wild at level 7');
    assert(!root.children[1].classList.contains('levelcard'));
  });

  // ------------------------------------------------------------ table layout
  const { createTableView } = await import('../ui/views/table.js');
  const { Game } = await import('../src/game.js');

  function tablePage() {
    const dom = new JSDOM(`<div id="t">
      ${[0, 1, 2, 3].map((i) => `<div id="seat-${i}"></div><div id="play-${i}"></div>`).join('')}
      <div id="label"></div><div id="turn"></div></div>`);
    globalThis.document = dom.window.document;
    globalThis.window = dom.window;
    const names = ['You', 'West', 'North', 'East'];
    const render = createTableView({
      seatRoot: (s) => document.getElementById(`seat-${s}`),
      playRoot: (s) => document.getElementById(`play-${s}`),
      labelNode: document.getElementById('label'),
      turnNode: document.getElementById('turn'),
      names, human: 0,
    });
    const game = new Game({ names });
    game.dealNumber = 1; game.levels = [2, 2]; game.finished = [];
    game.hands = [
      parseCards('SA HA C3'), parseCards('S9 H9 C4'),
      parseCards('SK HK C5'), parseCards('S7 H7 C6'),
    ];
    return { dom, render, game, $: (id) => document.getElementById(id) };
  }

  test('a play lands on the side of the table its player sits on', () => {
    const { render, game, $ } = tablePage();
    game.beginPlay(1);
    game.play(1, game.legalFor(1).find((m) => m.type === 'pair' && m.rank === 9));
    render({ game, thinkingSeat: null });

    const west = $('play-1');
    eq(west.querySelectorAll('.pcards .card').length, 2, 'West\'s pair is shown at West');
    assert(west.classList.contains('winning'), 'and marked as holding the trick');
    assert(west.textContent.includes('West'), 'labelled with the player who played it');
    for (const seat of [0, 2, 3]) {
      eq($(`play-${seat}`).querySelectorAll('.card').length, 0, `seat ${seat} has played nothing`);
      assert($(`play-${seat}`).classList.contains('empty'));
    }
    assert($('label').textContent.includes('West'), 'the centre says who must be beaten');
  });

  test('a pass shows as a pass, not as blank space', () => {
    const { render, game, $ } = tablePage();
    game.beginPlay(1);
    game.play(1, game.legalFor(1)[0]);
    game.pass(2);
    render({ game, thinkingSeat: null });
    eq($('play-2').querySelector('.passed').textContent, 'passed');
    assert(!$('play-2').classList.contains('winning'));
    assert($('play-1').classList.contains('winning'), 'the trick still belongs to West');
  });

  test('the trick marker moves when someone takes it over', () => {
    const { render, game, $ } = tablePage();
    game.beginPlay(1);
    game.play(1, game.legalFor(1).find((m) => m.type === 'single' && m.rank === 4));
    render({ game, thinkingSeat: null });
    assert($('play-1').classList.contains('winning'));

    game.play(2, game.legalFor(2).find((m) => m.type === 'single' && m.rank === 13));
    render({ game, thinkingSeat: null });
    assert($('play-2').classList.contains('winning'), 'North now holds it');
    assert(!$('play-1').classList.contains('winning'), 'and West no longer does');
  });

  test('opponents show a fan of backs that matches their hand size', () => {
    const { render, game, $ } = tablePage();
    game.beginPlay(1);
    render({ game, thinkingSeat: null });
    for (const seat of [1, 2, 3]) {
      const backs = $(`seat-${seat}`).querySelectorAll('.backs .card.back');
      eq(backs.length, game.hands[seat].length, `seat ${seat} shows one back per card`);
      assert([...backs].every((b) => b.textContent.trim() === ''), 'backs reveal nothing');
    }
    eq($('seat-0').querySelectorAll('.backs').length, 0, 'you see your own hand, not backs');
  });

  test('the fan tightens as a hand gets bigger so it always fits', () => {
    const { render, game, $ } = tablePage();
    game.beginPlay(1);
    render({ game, thinkingSeat: null });
    const tight = () => [...$('seat-1').querySelectorAll('.backs .card')][2]?.style.marginTop;
    const few = tight();
    game.hands[1] = parseCards('S2 S3 S4 S5 S6 S7 S8 S9 S10 SJ SQ SK SA H2 H3 H4 H5 H6 H7 H8');
    render({ game, thinkingSeat: null });
    const many = tight();
    assert(parseFloat(many) < parseFloat(few), `a 20-card fan (${many}) overlaps more than a 3-card one (${few})`);
  });

  test('the hand groups cards of the same rank into one stack', () => {
    const dom = page();
    const root = document.getElementById('root');
    const render = createHandView(root, { onToggle: () => {} });
    const cards = parseCards('SA HA CA SK C3');
    render({ cards, level: 2, selected: new Set(), interactive: true });
    const starts = [...root.children].map((n) => n.classList.contains('stack-start'));
    eq(starts, [true, false, false, true, true], 'three aces are one stack; K and 3 open their own');
  });
}
