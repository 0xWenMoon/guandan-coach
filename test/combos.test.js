import { test, assert, eq } from './run.js';
import { parseCards } from '../src/cards.js';
import { identify, identifyAll, beats, TYPE, describeCombo } from '../src/combos.js';

const id = (text, level = 2) => identify(parseCards(text), level);
const typeOf = (text, level = 2) => id(text, level)?.type ?? null;

test('basic types', () => {
  eq(typeOf('SA'), TYPE.SINGLE);
  eq(typeOf('SA HA'), TYPE.PAIR);
  eq(typeOf('SA HA CA'), TYPE.TRIPLE);
  eq(typeOf('SA HA CA S7 H7'), TYPE.FULLHOUSE);
  eq(typeOf('S3 H4 C5 D6 S7'), TYPE.STRAIGHT);
  eq(typeOf('S3 H3 C4 D4 S5 H5'), TYPE.TUBE);
  eq(typeOf('S3 H3 C3 D4 S4 H4'), TYPE.PLATE);
  eq(typeOf('SA HA CA DA'), TYPE.BOMB);
  eq(typeOf('S3 S4 S5 S6 S7'), TYPE.STRAIGHT_FLUSH);
  eq(typeOf('sj sj bj bj'), TYPE.ROCKET);
});

test('non-combos are rejected', () => {
  eq(typeOf('S3 H5'), null);
  eq(typeOf('S3 H4 C5 D6'), null);          // 4-card run is not a straight
  eq(typeOf('S3 H4 C5 D6 S8'), null);
  eq(typeOf('S3 H3 C4 D4'), null);          // only 2 consecutive pairs
  eq(typeOf('sj bj'), null);                // jokers are not a pair with each other
  eq(typeOf('sj sj'), TYPE.PAIR);           // but two small jokers are
});

test('ace plays high or low in sequences', () => {
  eq(id('SA H2 C3 D4 S5').rank, 5, 'A2345 tops at 5');
  eq(id('S10 HJ CQ DK SA').rank, 14, '10JQKA tops at A');
  eq(typeOf('SK HA C2 D3 S4'), null, 'no wrap-around through A');
  eq(typeOf('SA HA C2 D2 S3 H3'), TYPE.TUBE, 'AA2233 is legal');
  eq(typeOf('SA HA CA D2 S2 H2'), TYPE.PLATE, 'AAA222 is legal');
});

test('level card outranks A but not jokers', () => {
  const level = 7;
  assert(beats(id('S7', level), id('SA', level)), 'level 7 beats A');
  assert(beats(id('sj', level), id('S7', level)), 'small joker beats level card');
  assert(beats(id('bj', level), id('sj', level)), 'big joker beats small joker');
  assert(!beats(id('SK', level), id('S7', level)), 'K does not beat level card');
  assert(beats(id('S7 H7', level), id('SA HA', level)), 'level pair beats pair of aces');
});

test('level card keeps its natural rank inside a straight', () => {
  const level = 7;
  eq(typeOf('S5 H6 C7 D8 S9', level), TYPE.STRAIGHT, '7 sits between 6 and 8');
  eq(id('S5 H6 C7 D8 S9', level).rank, 9);
});

test('wildcards stand in for any non-joker card', () => {
  const L = 5;
  eq(typeOf('H5 S9', L), TYPE.PAIR, 'wild + 9 = pair of 9s');
  eq(id('H5 S9', L).rank, 9);
  eq(typeOf('H5 S9 C9', L), TYPE.TRIPLE, 'wild + 99 = triple 9s');
  eq(typeOf('H5 S3 C4 D6 S7', L), TYPE.STRAIGHT, 'wild fills the gap at 5');
  eq(id('H5 S3 C4 D6 S7', L).rank, 7);
  eq(typeOf('H5 SA CA DA', L), TYPE.BOMB, 'wild completes a four-bomb');
  eq(typeOf('H5 H5 SA CA', L), TYPE.BOMB, 'both wilds complete a four-bomb');
  eq(typeOf('H5 sj bj', L), null, 'a wildcard cannot stand in for a joker');
  eq(typeOf('H5 sj', L), null);
});

test('a lone wildcard is just a level card', () => {
  const L = 5;
  eq(typeOf('H5', L), TYPE.SINGLE);
  eq(id('H5', L).rank, 14.5);
  assert(beats(id('H5', L), id('SA', L)));
});

test('two wildcards alone make the best pair available', () => {
  const L = 5;
  const c = id('H5 H5', L);
  eq(c.type, TYPE.PAIR);
  eq(c.rank, 14.5, 'read as a pair of level cards, the strongest legal pair');
});

test('bomb ordering: 4 < 5 < straight flush < 6 < four kings', () => {
  const L = 2;
  const b4 = id('SA HA CA DA', L);
  const b5 = id('S3 H3 C3 D3 S3', L);
  const sf = id('S3 S4 S5 S6 S7', L);
  const b6 = id('S3 H3 C3 D3 S3 H3', L);
  const rocket = id('sj sj bj bj', L);
  assert(beats(b5, b4), '5-bomb beats 4-bomb of aces');
  assert(beats(sf, b5), 'straight flush beats 5-bomb');
  assert(beats(b6, sf), '6-bomb beats straight flush');
  assert(beats(rocket, b6), 'four kings beats everything');
  assert(!beats(b4, b5));
  assert(!beats(sf, b6));
  assert(!beats(b6, rocket));
});

test('bombs beat any non-bomb, never the reverse', () => {
  const L = 2;
  const b4 = id('S3 H3 C3 D3', L);
  const straight = id('S10 HJ CQ DK SA', L);
  assert(beats(b4, straight));
  assert(!beats(straight, b4));
});

test('same type and length required for non-bombs', () => {
  const L = 2;
  assert(!beats(id('SA HA CA', L), id('SK HK', L)), 'triple does not beat a pair');
  assert(beats(id('SA HA', L), id('SK HK', L)));
});

test('straight flush is also readable as a plain straight', () => {
  const readings = identifyAll(parseCards('S3 S4 S5 S6 S7'), 2).map((c) => c.type);
  assert(readings.includes(TYPE.STRAIGHT_FLUSH));
  assert(readings.includes(TYPE.STRAIGHT), 'player may choose not to spend the bomb');
});

test('descriptions read sensibly', () => {
  eq(describeCombo(id('S7', 7), 7), 'single 7s (level card)');
  eq(describeCombo(id('S10 HJ CQ DK SA'), 2), 'straight to A');
  eq(describeCombo(id('SA HA CA S7 H7'), 2), 'full house, A over 7');
});
