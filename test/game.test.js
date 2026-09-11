import { test, assert, eq } from './run.js';
import { parseCards, sortHand, makeDeck } from '../src/cards.js';
import { identify } from '../src/combos.js';
import { Game, PHASE, teamOf, partnerOf, highestTributeCard } from '../src/game.js';

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Drive a deal to completion with random legal choices. */
function playRandomDeal(game, rng) {
  let guard = 0;
  while (game.phase === PHASE.RETURN) {
    const seat = game.tribute.pending[0];
    game.returnCard(seat, game.autoReturnCard(seat));
  }
  while (game.phase === PHASE.PLAYING) {
    if (guard++ > 5000) throw new Error('deal did not terminate');
    const seat = game.current;
    const moves = game.legalFor(seat);
    if (!game.trick.target) {
      assert(moves.length > 0, 'a player on lead always has a legal move');
      game.play(seat, moves[Math.floor(rng() * moves.length)]);
    } else if (moves.length === 0 || rng() < 0.35) {
      game.pass(seat);
    } else {
      game.play(seat, moves[Math.floor(rng() * moves.length)]);
    }
  }
}

test('a deal always terminates with a legal result', () => {
  const rng = mulberry32(7);
  for (let i = 0; i < 40; i++) {
    const g = new Game({ rng });
    g.startDeal();
    playRandomDeal(g, rng);
    const r = g.result;
    eq(r.order.length, 4, 'four finishing places');
    eq(new Set(r.order).size, 4, 'each seat placed once');
    assert([1, 2, 3].includes(r.gain), `gain ${r.gain} out of range`);
    eq(teamOf(r.order[0]), r.winTeam);
    const dealt = g.hands.reduce((n, h) => n + h.length, 0);
    const played = g.log.filter((e) => e.kind === 'play').reduce((n, e) => n + e.combo.cards.length, 0);
    eq(dealt + played, 108, 'cards are conserved');
  }
});

test('gain matches the partner finishing position', () => {
  const rng = mulberry32(21);
  for (let i = 0; i < 60; i++) {
    const g = new Game({ rng });
    g.startDeal();
    playRandomDeal(g, rng);
    const { order, gain } = g.result;
    const place = order.indexOf(partnerOf(order[0]));
    eq(gain, place === 1 ? 3 : place === 2 ? 2 : 1, `place ${place} should not give ${gain}`);
  }
});

test('a full match ends with one team winning at A', () => {
  const rng = mulberry32(3);
  const g = new Game({ rng });
  let deals = 0;
  while (g.phase !== PHASE.MATCH_OVER) {
    if (deals++ > 200) throw new Error('match never ended');
    g.startDeal();
    playRandomDeal(g, rng);
  }
  assert(g.winner === 0 || g.winner === 1);
  eq(g.levels[g.winner], 14, 'the winning team finished at A');
  assert(g.levels.every((l) => l >= 2 && l <= 14), 'levels stay in range');
});

test('levels never jump past A', () => {
  const g = new Game({ rng: mulberry32(5) });
  g.levels = [13, 2];
  g.activeTeam = 0;
  g.finished = [0, 2, 1, 3];  // team 0 double-up = +3
  g.dealNumber = 1;
  const r = g.endDeal();
  eq(r.gain, 3);
  eq(g.levels[0], 14, 'K + 3 stops at A rather than overshooting');
  assert(!r.matchWon, 'reaching A is not the same as winning at A');
});

test('winning a deal while already at A wins the match', () => {
  const g = new Game({ rng: mulberry32(5) });
  g.levels = [14, 9];
  g.activeTeam = 0;
  g.finished = [0, 1, 2, 3];  // team 0 first and third = +2, but they are at A
  g.dealNumber = 1;
  const r = g.endDeal();
  assert(r.matchWon);
  eq(g.winner, 0);
  eq(g.phase, PHASE.MATCH_OVER);
});

test('three failed attempts at A drop a team back to 2', () => {
  const g = new Game({ rng: mulberry32(5) });
  g.levels = [14, 2];
  for (let i = 0; i < 3; i++) {
    g.activeTeam = 1;
    g.finished = [1, 3, 0, 2];   // team 1 wins, team 0 sits at A and fails
    g.dealNumber = i + 1;
    g.endDeal();
    if (i < 2) eq(g.levels[0], 14, `still at A after ${i + 1} failure(s)`);
  }
  eq(g.levels[0], 2, 'back to 2 after the third failure');
});

test('接风: a partner going out hands you the lead', () => {
  const g = new Game({ rng: mulberry32(1) });
  g.dealNumber = 1;
  g.levels = [2, 2];
  g.finished = [];
  g.hands = [parseCards('SA'), parseCards('S3 H3'), parseCards('S4 H4'), parseCards('S5 H5')];
  g.beginPlay(0);
  g.play(0, g.legalFor(0)[0]);
  eq(g.finished, [0], 'seat 0 is out');
  g.pass(1); g.pass(2); g.pass(3);
  eq(g.current, 2, 'the lead jumps to the partner, not to seat 1');
  assert(g.log.some((e) => e.kind === 'jiefeng'), 'logged as 接风');
  assert(!g.trick.target, 'and it is a free lead');
});

test('a deal ends as soon as one team has both players out', () => {
  const g = new Game({ rng: mulberry32(1) });
  g.dealNumber = 1;
  g.levels = [2, 2];
  g.finished = [];
  g.hands = [parseCards('SA'), parseCards('S3 H3 C3'), parseCards('S4'), parseCards('S5 H5 C5')];
  g.beginPlay(0);
  g.play(0, g.legalFor(0)[0]);
  g.pass(1); g.pass(2); g.pass(3);
  eq(g.current, 2);
  g.play(2, g.legalFor(2)[0]);
  eq(g.phase, PHASE.DEAL_OVER, 'double-up ends it immediately');
  eq(g.result.gain, 3);
  eq(g.result.order.slice(0, 2), [0, 2]);
});

test('tribute: the loser hands over their highest card, ♥level excepted', () => {
  eq(highestTributeCard(parseCards('S3 HA C9'), 2).rank, 14);
  eq(highestTributeCard(parseCards('S3 H5 C9'), 5).rank, 9, '♥5 at level 5 is exempt');
  eq(highestTributeCard(parseCards('S3 bj C9'), 2).rank, 16, 'a joker is fair game');
});

test('tribute and return move the right cards', () => {
  const g = new Game({ rng: mulberry32(11) });
  g.levels = [2, 2]; g.activeTeam = 0; g.dealNumber = 1;
  g.lastFinishOrder = [0, 2, 1, 3];   // team 0 double-up, so seats 1 and 3 both pay
  g.finished = [];
  g.hands = [
    parseCards('S2 S3 S4'), parseCards('HA H9 H8'),
    parseCards('C2 C3 C4'), parseCards('DK D9 D8'),
  ];
  g.setupTribute();
  eq(g.phase, PHASE.RETURN);
  const tributes = g.log.filter((e) => e.kind === 'tribute');
  eq(tributes.length, 2);
  eq(tributes[0].card.rank, 14, 'the ace is the bigger tribute');
  eq(tributes[0].to, 0, 'and it goes to the first-place player');
  eq(tributes[1].to, 2, 'the K goes to the second-place player');
  assert(g.hands[0].some((c) => c.rank === 14), 'seat 0 received the ace');
  eq(g.hands[1].length, 2, 'seat 1 gave one away');

  g.returnCard(0, g.autoReturnCard(0));
  g.returnCard(2, g.autoReturnCard(2));
  eq(g.phase, PHASE.PLAYING);
  eq(g.current, 1, 'whoever paid the first-place player leads');
  eq(g.hands.reduce((n, h) => n + h.length, 0), 12, 'no cards lost in the exchange');
});

test('抗贡: holding both big jokers cancels tribute', () => {
  const g = new Game({ rng: mulberry32(11) });
  g.levels = [2, 2]; g.activeTeam = 0; g.dealNumber = 1;
  g.lastFinishOrder = [0, 2, 1, 3];
  g.finished = [];
  g.hands = [
    parseCards('S2 S3'), parseCards('bj H9'),
    parseCards('C2 C3'), parseCards('bj D9'),
  ];
  g.setupTribute();
  assert(g.log.some((e) => e.kind === 'resist'), 'tribute refused');
  eq(g.phase, PHASE.PLAYING);
  eq(g.current, 0, 'the first-place player leads when tribute is resisted');
});

test('single loss: only the last-place player pays', () => {
  const g = new Game({ rng: mulberry32(11) });
  g.levels = [2, 2]; g.activeTeam = 0; g.dealNumber = 1;
  g.lastFinishOrder = [0, 1, 2, 3];   // partners split, so this is a single loss
  g.finished = [];
  g.hands = [parseCards('S2 S3'), parseCards('HA H9'), parseCards('C2 C3'), parseCards('DK D9')];
  g.setupTribute();
  const tributes = g.log.filter((e) => e.kind === 'tribute');
  eq(tributes.length, 1);
  eq(tributes[0].from, 3);
  eq(tributes[0].to, 0);
  g.returnCard(0, g.autoReturnCard(0));
  eq(g.current, 3, 'the payer leads');
});

test('illegal plays are rejected', () => {
  const g = new Game({ rng: mulberry32(1) });
  g.dealNumber = 1; g.levels = [2, 2]; g.finished = [];
  g.hands = [parseCards('SA HA'), parseCards('S3 H3'), parseCards('S4 H4'), parseCards('S5 H5')];
  g.beginPlay(0);
  let threw = false;
  try { g.play(0, identify(parseCards('SK HK'), 2)); } catch { threw = true; }
  assert(threw, 'cannot play cards you do not hold');
  threw = false;
  try { g.pass(0); } catch { threw = true; }
  assert(threw, 'cannot pass on a free lead');
  g.play(0, g.legalFor(0)[0]);
  threw = false;
  try { g.play(2, g.legalFor(2)[0]); } catch { threw = true; }
  assert(threw, 'cannot play out of turn');
});
