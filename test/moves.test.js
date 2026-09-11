import { test, assert, eq } from './run.js';
import { parseCards, sortHand } from '../src/cards.js';
import { identify, beats, TYPE, isBomb } from '../src/combos.js';
import { legalMoves, removeCards } from '../src/moves.js';

const hand = (t) => parseCards(t);

test('every generated move is a legal combo and beats the target', () => {
  const h = hand('SA HA CK DK S3 H3 C3 D3 S5 H6 C7 D8 S9 H5');
  for (const target of [null, identify(hand('S4'), 2), identify(hand('S4 H4'), 2), identify(hand('S5 H6 C7 D8 S9'), 2)]) {
    for (const m of legalMoves(h, 2, target)) {
      const re = identify(m.cards, 2);
      assert(re, `generated an unplayable set: ${m.type}`);
      assert(beats(m, target), `${m.type}@${m.rank} does not beat target`);
      assert(m.cards.length === new Set(m.cards.map((c) => c.id)).size, 'reused a card');
      const ids = new Set(h.map((c) => c.id));
      assert(m.cards.every((c) => ids.has(c.id)), 'played a card not in hand');
    }
  }
});

test('no move is generated from cards you do not hold', () => {
  const h = hand('S3 H4');
  eq(legalMoves(h, 2, identify(hand('SA'), 2)).length, 0, 'nothing beats an ace here');
  assert(legalMoves(h, 2, null).length > 0);
});

test('bombs are offered against any non-bomb', () => {
  const h = hand('S3 H3 C3 D3 S9');
  const moves = legalMoves(h, 2, identify(hand('SA HA'), 2));
  assert(moves.length === 1 && moves[0].type === TYPE.BOMB, 'only the bomb answers a pair of aces');
});

test('only stronger bombs answer a bomb', () => {
  const h = hand('S3 H3 C3 D3 SA HA CA DA S5 S6 S7 S8 S9');
  const target = identify(hand('S8 H8 C8 D8'), 2);
  const moves = legalMoves(h, 2, target);
  assert(moves.every((m) => isBomb(m) && beats(m, target)));
  assert(moves.some((m) => m.type === TYPE.BOMB && m.rank === 14), 'ace bomb answers an 8 bomb');
  assert(!moves.some((m) => m.type === TYPE.BOMB && m.rank === 3), '3 bomb does not');
  assert(moves.some((m) => m.type === TYPE.STRAIGHT_FLUSH), 'the 5-6-7-8-9 flush is a bomb too');
});

test('wildcards are spent only when they are needed', () => {
  const L = 5;
  const h = hand('H5 SA HA S9');
  const moves = legalMoves(h, L, identify(hand('SK HK'), L));
  const acePair = moves.find((m) => m.type === TYPE.PAIR && m.rank === 14);
  assert(acePair, 'pair of aces is available');
  eq(acePair.wilds, 0, 'it should not burn the wildcard');
  assert(!moves.some((m) => m.type === TYPE.PAIR && m.rank === 14.5),
    'one wildcard and no other 5 cannot make a pair of level cards');

  const two = hand('H5 H5 S9');
  const pairs = legalMoves(two, L, identify(hand('SK HK'), L));
  assert(pairs.some((m) => m.type === TYPE.PAIR && m.rank === 14.5),
    'two wildcards can be declared as a pair of level cards');
});

test('a wildcard can complete a straight or a bomb', () => {
  const L = 5;
  const h = hand('H5 S3 C4 D6 S7 SA CA DA');
  const moves = legalMoves(h, L, null);
  assert(moves.some((m) => m.type === TYPE.STRAIGHT && m.rank === 7), 'wild fills the 5');
  assert(moves.some((m) => m.type === TYPE.BOMB && m.rank === 14), 'wild makes the ace bomb');
});

test('moves shrink the hand correctly', () => {
  const h = hand('SA HA CK DK');
  const m = legalMoves(h, 2, null).find((x) => x.type === TYPE.PAIR && x.rank === 14);
  eq(removeCards(h, m.cards).length, 2);
});

test('generation stays fast on a full 27-card hand', () => {
  const h = sortHand(parseCards(
    'SA HA CA DA SK HK CK S2 H2 C3 D4 S5 H6 C7 D8 S9 H10 CJ DQ S3 H4 C5 D6 S7 H8 C9 D10',
  ), 2);
  const t0 = Date.now();
  let n = 0;
  for (let i = 0; i < 200; i++) n = legalMoves(h, 2, null).length;
  const ms = Date.now() - t0;
  assert(ms < 1500, `200 full generations took ${ms}ms`);
  assert(n > 20 && n < 400, `move count ${n} looks wrong`);
});

test('a play is judged by the combination, not by which copy of a card you picked', async () => {
  const { Game } = await import('../src/game.js');
  const g = new Game({ rng: Math.random });
  g.dealNumber = 1; g.levels = [2, 2]; g.finished = [];
  g.hands = [
    parseCards('S3 H3 C3 S5 H5 D5'), parseCards('S9'), parseCards('C9'), parseCards('D9'),
  ];
  g.beginPlay(0);
  const { identifyAll } = await import('../src/combos.js');
  // Deliberately use the third copy of the 5s, which the generator would not pick.
  const chosen = g.hands[0].filter((c) => c.rank === 3 || c.suit === 'D' || c.suit === 'H');
  const cards = g.hands[0].filter((c) => c.rank === 3)
    .concat(g.hands[0].filter((c) => c.rank === 5 && c.suit !== 'S'));
  const combo = identifyAll(cards, 2).find((r) => r.type === 'fullhouse');
  assert(combo, 'the selection is a full house');
  g.play(0, combo);
  eq(g.hands[0].length, 1, 'the play was accepted');
});

test('readingFor prefers the cheapest legal reading', async () => {
  const { readingFor } = await import('../src/moves.js');
  const flush = parseCards('S3 S4 S5 S6 S7');
  eq(readingFor(flush, 2, null).combo.type, TYPE.STRAIGHT, 'do not spend a straight flush on a free lead');
  const bomb = identify(parseCards('SA HA CA DA'), 2);
  eq(readingFor(flush, 2, bomb).combo.type, TYPE.STRAIGHT_FLUSH, 'but do spend it to answer a bomb');
  eq(readingFor(parseCards('S3 H7'), 2, null).combo, undefined);
  assert(readingFor(parseCards('S3 H7'), 2, null).error);
});

test('a lone wildcard can only be played as the level card', () => {
  const L = 2;
  const moves = legalMoves(parseCards('H2 S9'), L, null);
  const singles = moves.filter((m) => m.type === TYPE.SINGLE);
  const wildSingles = singles.filter((m) => m.cards.length === 1 && m.cards[0].suit === 'H' && m.cards[0].rank === 2);
  eq(wildSingles.length, 1, 'exactly one reading of the bare wildcard');
  eq(wildSingles[0].rank, 14.5, 'and it is the level card, not some other rank');
  assert(!singles.some((m) => m.rank === 7), 'the wildcard is not offered as a 7');
});

test('every generated move survives the game\'s own validation', async () => {
  const { Game, PHASE } = await import('../src/game.js');
  const { identifyAll } = await import('../src/combos.js');
  let seed = 99;
  const rng = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  for (let i = 0; i < 25; i++) {
    const g = new Game({ rng });
    g.startDeal();
    while (g.phase === PHASE.RETURN) g.returnCard(g.tribute.pending[0], g.autoReturnCard(g.tribute.pending[0]));
    let guard = 0;
    while (g.phase === PHASE.PLAYING) {
      if (guard++ > 4000) break;
      const seat = g.current;
      const moves = g.legalFor(seat);
      for (const m of moves) {
        const ok = identifyAll(m.cards, g.level).some((r) => r.type === m.type && r.rank === m.rank);
        assert(ok, `generator produced ${m.type}@${m.rank} that identifyAll rejects`);
      }
      if (!g.trick.target) g.play(seat, moves[Math.floor(rng() * moves.length)]);
      else if (!moves.length || rng() < 0.35) g.pass(seat);
      else g.play(seat, moves[Math.floor(rng() * moves.length)]);
    }
  }
});
