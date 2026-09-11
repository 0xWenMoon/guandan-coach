import { test, assert, eq } from './run.js';
import { Game, PHASE, teamOf } from '../src/game.js';
import { snapshot, restore } from '../src/serialize.js';
import { analyze } from '../src/bot.js';
import { review } from '../src/coach.js';
import { readingFor } from '../src/moves.js';

function dealt(seed = 4) {
  let s = seed;
  const rng = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  const g = new Game({ rng, names: ['You', 'West', 'North', 'East'] });
  g.startDeal();
  while (g.phase === PHASE.RETURN) g.returnCard(g.tribute.pending[0], g.autoReturnCard(g.tribute.pending[0]));
  return g;
}

test('a snapshot hides every hand except the one it is for', () => {
  const g = dealt();
  const snap = snapshot(g, 1);
  eq(snap.hands[1].length, g.hands[1].length);
  assert(snap.hands[1].every((c) => c && c.id), 'own hand is intact');
  for (const s of [0, 2, 3]) {
    eq(snap.hands[s].length, g.hands[s].length, 'card count is visible');
    assert(snap.hands[s].every((c) => c === null), `seat ${s} cards are redacted`);
  }
  const json = JSON.stringify(snap);
  for (const c of g.hands[0]) assert(!json.includes(`"${c.id}"`), `leaked ${c.id} from the human hand`);
});

test('the bot plays legally from a redacted snapshot', () => {
  const g = dealt();
  const seat = g.current;
  const a = analyze(restore(snapshot(g, seat)), seat, { samples: 4, limit: 6, timeBudgetMs: 4000 });
  assert(a.ranked.length, 'it produced candidates');
  const move = a.best.move;
  if (move) {
    // The real game must accept what the worker returned.
    const real = { ...move, cards: move.cards.map((c) => g.hands[seat].find((x) => x.id === c.id)) };
    assert(real.cards.every(Boolean), 'every card maps back into the real hand');
    g.play(seat, real);
  } else {
    g.pass(seat);
  }
});

test('a whole deal can be played through the snapshot boundary', () => {
  const g = dealt(9);
  let guard = 0;
  while (g.phase === PHASE.PLAYING) {
    if (guard++ > 600) throw new Error('did not finish');
    const seat = g.current;
    const a = analyze(restore(snapshot(g, seat)), seat, { samples: 2, limit: 5, timeBudgetMs: 2000 });
    const move = a.best?.move;
    if (move) {
      g.play(seat, { ...move, cards: move.cards.map((c) => g.hands[seat].find((x) => x.id === c.id)) });
    } else if (g.trick.target) {
      g.pass(seat);
    } else {
      g.play(seat, g.legalFor(seat)[0]);
    }
  }
  eq(g.result.order.length, 4);
});

test('review works over the boundary and always explains itself', () => {
  const g = dealt(12);
  const seat = g.current;
  const restored = restore(snapshot(g, seat));
  const moves = restored.legalFor(seat);
  for (const move of [moves[0], moves[moves.length - 1], null]) {
    if (!move && !restored.trick.target) continue;
    const r = review(restored, seat, move, { samples: 3, limit: 5, timeBudgetMs: 3000 });
    assert(r, 'a review came back');
    assert(r.headline && r.headline.length > 10, 'it has a headline');
    assert(r.reasons.length > 0, 'it gives at least one reason');
    assert(r.reasons.every((x) => typeof x.text === 'string' && x.text.length > 20), 'reasons are real sentences');
    assert(['best', 'good', 'fine', 'inaccuracy', 'mistake', 'blunder'].includes(r.verdict));
    assert(JSON.stringify(r).length > 0, 'the review is serialisable back to the page');
  }
});

test('a verdict never contradicts its own cost', () => {
  const g = dealt(31);
  const seat = g.current;
  const restored = restore(snapshot(g, seat));
  for (const move of restored.legalFor(seat).slice(0, 6)) {
    const r = review(restored, seat, move, { samples: 4, limit: 6, timeBudgetMs: 3000 });
    if (r.cost > 1.1) {
      assert(!r.reasons.some((x) => x.text.includes('difference is small')),
        'a costly move must not be described as a small difference');
    }
    if (r.verdict === 'best') eq(r.alternative, null, 'the best move has no better alternative');
  }
});

test('readingFor drives the Play button the same way the game validates', () => {
  const g = dealt(17);
  const seat = g.current;
  const moves = g.legalFor(seat);
  for (const m of moves.slice(0, 8)) {
    const res = readingFor(m.cards, g.level, g.trick.target);
    assert(!res.error, `the UI would reject a legal move: ${m.type}`);
    const probe = Object.create(Object.getPrototypeOf(g));
    Object.assign(probe, g, { hands: g.hands.map((h) => h.slice()), log: { push() {} },
      trick: { ...g.trick, passed: new Set(g.trick.passed), plays: [] },
      finished: g.finished.slice(), playedCards: new Set(g.playedCards) });
    probe.play(seat, res.combo);   // throws if the game disagrees with the UI
  }
});
