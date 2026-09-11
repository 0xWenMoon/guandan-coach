import { test, assert, eq } from './run.js';
import { parseCards, sortHand } from '../src/cards.js';
import { Game, PHASE } from '../src/game.js';
import { identify } from '../src/combos.js';
import {
  outstanding, highestOutstanding, bombThreats, exhaustedRanks,
  unbeatableExceptBombs, handPlan, race, label,
} from '../src/knowledge.js';
import { review, PRINCIPLES } from '../src/coach.js';

function table(hands, level = 2, leader = 0) {
  const g = new Game({ names: ['You', 'West', 'North', 'East'] });
  g.dealNumber = 1;
  g.levels = [level, level];
  g.activeTeam = 0;
  g.finished = [];
  g.hands = hands.map((h) => sortHand(parseCards(h), level));
  g.beginPlay(leader);
  return g;
}

// ---------------------------------------------------------------- counting

test('outstanding counts everything you cannot see', () => {
  const g = table(['SA HA C3', 'S9', 'C9', 'D9']);
  const left = outstanding(g, 0);
  eq(left.get(14), 6, 'you hold two of the eight aces');
  eq(left.get(3), 7, 'and one of the eight threes');
  eq(left.get(9), 8, 'the nines are all unseen — your own view cannot see other hands');
  eq(left.get(16), 2, 'both big jokers unaccounted for');
  eq([...left.values()].reduce((a, b) => a + b, 0), 108 - 3, 'everything but your own hand');
});

test('cards that have been played stop being outstanding', () => {
  const g = table(['SA HA C3', 'S9 H9', 'C9', 'D9']);
  g.play(0, identify(parseCards('C3'), 2));
  const left = outstanding(g, 0);
  eq(left.get(3), 7, 'your played 3 is accounted for, not double counted');
  g.play(1, identify(g.hands[1].filter((c) => c.rank === 9).slice(0, 1), 2));
  eq(outstanding(g, 0).get(9), 7, 'West showing a 9 removes it from the unknown');
});

test('断张: a rank you hold none of shows up as bomb material', () => {
  const g = table(['SA HA CK DK S3 H3', 'S9', 'C9', 'D9']);
  const threats = bombThreats(g, 0, outstanding(g, 0));
  const blind = threats.find((t) => t.held === 0 && t.outside === 8);
  assert(blind, 'some rank is entirely unseen');
  assert(![14, 13, 3].includes(blind.rank), 'and it is not one you hold');
  const ace = threats.find((t) => t.rank === 14);
  eq(ace.outside, 6, 'holding two aces leaves six outside');
  eq(ace.held, 2);
});

test('a rank is exhausted once every copy is visible', () => {
  const g = table(['S2 H2 C2 D2 S3', 'S9', 'C9', 'D9']);
  let left = outstanding(g, 0);
  assert(!exhaustedRanks(left).includes(2), 'four 2s held, four still out');
  // Two decks: play the other four 2s into the record.
  for (const id of ['2S1', '2H1', '2C1', '2D1']) g.playedCards.add(id);
  left = outstanding(g, 0);
  assert(exhaustedRanks(left).includes(2), 'now every 2 is accounted for');
});

test('knowing when your card can no longer be beaten', () => {
  const g = table(['SK HK C3', 'S9', 'C9', 'D9']);
  const left = outstanding(g, 0);
  const king = identify(parseCards('SK'), 2);
  assert(!unbeatableExceptBombs(king, left, 2), 'aces and jokers are still out there');

  // Retire every ace, level card and joker.
  for (const suit of ['S', 'H', 'C', 'D']) {
    for (const copy of [0, 1]) {
      g.playedCards.add(`14${suit}${copy}`);
      g.playedCards.add(`2${suit}${copy}`);
    }
  }
  for (const copy of [0, 1]) { g.playedCards.add(`15J${copy}`); g.playedCards.add(`16J${copy}`); }
  const after = outstanding(g, 0);
  assert(unbeatableExceptBombs(king, after, 2), 'the K is now the best single left');
  const three = identify(parseCards('C3'), 2);
  assert(!unbeatableExceptBombs(three, after, 2), 'but a 3 certainly is not');
});

test('the hand plan counts turns, bombs and controlling cards', () => {
  const plan = handPlan(parseCards('SA HA CA DA S3 H4 C5 D6 S7 bj'), 2);
  eq(plan.cards, 10);
  eq(plan.bombs, 1, 'the four aces are a bomb');
  assert(plan.turns >= 3 && plan.turns <= 4, `turns was ${plan.turns}`);
  assert(plan.control >= 2, 'the bomb ranks and the joker count as control');
});

test('the race notices when your partner is the one who should finish', () => {
  const g = table(['SA HA CA DA SK HK CK DK S2 H2', 'S9', 'C9 H9', 'D9']);
  const r = race(g, 0);
  eq(r.me, 10);
  eq(r.partner, 2);
  assert(r.supportPartner, 'partner is far closer to out, so support them');
  eq(r.danger.cards, 1, 'and the nearest opponent has one card');
});

test('jokers get readable names', () => {
  eq(label(16), 'big joker');
  eq(label(15), 'small joker');
  eq(label(14), 'A');
});

// ---------------------------------------------------------------- the review

const quick = { samples: 6, limit: 6, timeBudgetMs: 4000 };

test('a review always explains itself and cites principles properly', () => {
  const g = table(['SA HA CK DK S5 H6 C7 D8 S9 H3', 'S9 H9 C2', 'C9 D2 S4', 'D9 H4 C6']);
  for (const move of g.legalFor(0).slice(0, 5)) {
    const r = review(g, 0, move, quick);
    assert(r.reasons.length > 0, 'at least one reason');
    for (const reason of r.reasons) {
      assert(reason.text.length > 20, 'reasons are real sentences');
      if (reason.principle) {
        assert(reason.principle.cn && reason.principle.en, 'a principle has both names');
        assert(Object.values(PRINCIPLES).includes(reason.principle), 'and comes from the list');
      }
    }
    assert(r.table.length >= 2, 'the table facts are always shown');
    assert(r.table.every((f) => f.label && f.text), 'each fact is labelled');
  }
});

test('the coach never tells you off for something it also recommends', () => {
  // Partner leads, you are next: any criticism for overtaking them must not sit
  // next to a recommendation that also overtakes them.
  const g = table(['SA HA CA DA S5 H6', 'S3 H3', 'C4 D4', 'D7 H7'], 2, 2);
  g.play(2, g.legalFor(2)[0]);
  g.pass(3);
  for (const move of g.legalFor(0).slice(0, 4)) {
    const r = review(g, 0, move, quick);
    const scolded = r.reasons.some((x) => x.tag === 'partner');
    if (scolded) eq(r.best, null, 'only says "do not overtake your partner" when it would pass');
  }
});

test('verdict, cost and alternative always agree', () => {
  const g = table(['SA HA CK DK S5 H6 C7 D8 S9 H3', 'S9 H9 C2', 'C9 D2 S4', 'D9 H4 C6']);
  for (const move of g.legalFor(0).slice(0, 6)) {
    const r = review(g, 0, move, quick);
    if (r.verdict === 'best') eq(r.alternative, null, 'the best move has no better alternative');
    if (r.cost > 1.1) {
      assert(!r.reasons.some((x) => x.text.includes('difference is small')),
        'a costly move is never described as a small difference');
    }
    if (r.confident === false) {
      assert(r.margin === null || r.margin < 0.2, 'low confidence means a genuinely close call');
    }
  }
});

test('it points out when your play cannot be beaten any more', () => {
  const g = table(['SK HK C3 D4 S6 H7', 'S3 H8', 'C4 D8', 'D5 H9'], 2);
  for (const suit of ['S', 'H', 'C', 'D']) {
    for (const copy of [0, 1]) { g.playedCards.add(`14${suit}${copy}`); g.playedCards.add(`2${suit}${copy}`); }
  }
  for (const copy of [0, 1]) { g.playedCards.add(`15J${copy}`); g.playedCards.add(`16J${copy}`); }
  const king = g.legalFor(0).find((m) => m.type === 'single' && m.rank === 13);
  const r = review(g, 0, king, quick);
  assert(r.reasons.some((x) => x.tag === 'boss'), 'the coach should notice the K is now the boss');
});

test('it tells you to feed your partner when their race is the live one', () => {
  const g = table([
    'SA HA CA DA SK HK CK DK S2 H2 C5 D6',
    'S9 H9 C9', 'C3 D3', 'D7 H7 S8',
  ], 2);
  const r = review(g, 0, g.legalFor(0)[0], quick);
  assert(r.reasons.some((x) => x.tag === 'support'), 'partner on 2 cards, you on 12');
});
