// Hand decomposition: break a hand into the structures you intend to play,
// which gives 手数 (how many turns the hand needs) and feeds both the bot's
// policy and the coach's explanations.
import { isWild, isJoker, playValue, SMALL_JOKER, BIG_JOKER } from './cards.js';
import { TYPE, seqRank } from './combos.js';

const mk = (type, cards, rank, extra = {}) => ({ type, cards, rank, ...extra });

/**
 * Greedy decomposition, biggest-value shapes first: rockets and bombs are kept
 * whole, then consecutive triples, consecutive pairs, straights, and finally
 * whatever is left as full houses / triples / pairs / singles.
 */
export function decompose(hand, level) {
  const byRank = new Map();
  const wilds = [];
  for (const c of hand) {
    if (isWild(c, level)) { wilds.push(c); continue; }
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
  }
  const cnt = (r) => byRank.get(r)?.length ?? 0;
  const take = (r, n) => (byRank.get(r) ?? []).splice(0, n);
  const plays = [];

  if (cnt(SMALL_JOKER) >= 2 && cnt(BIG_JOKER) >= 2) {
    plays.push(mk(TYPE.ROCKET, take(SMALL_JOKER, 2).concat(take(BIG_JOKER, 2)), 1000));
  }
  for (let r = 2; r <= 14; r++) {
    if (cnt(r) >= 4) plays.push(mk(TYPE.BOMB, take(r, cnt(r)), playValue(r, level)));
  }
  for (let s = 1; s + 1 <= 14; s++) {
    const a = seqRank(s), b = seqRank(s + 1);
    while (cnt(a) >= 3 && cnt(b) >= 3) {
      plays.push(mk(TYPE.PLATE, take(a, 3).concat(take(b, 3)), s + 1));
    }
  }
  for (let s = 1; s + 2 <= 14; s++) {
    const rs = [seqRank(s), seqRank(s + 1), seqRank(s + 2)];
    while (rs.every((r) => cnt(r) >= 2)) {
      plays.push(mk(TYPE.TUBE, rs.flatMap((r) => take(r, 2)), s + 2));
    }
  }
  for (let s = 1; s + 4 <= 14; s++) {
    const rs = [0, 1, 2, 3, 4].map((i) => seqRank(s + i));
    while (rs.every((r) => cnt(r) >= 1)) {
      plays.push(mk(TYPE.STRAIGHT, rs.map((r) => take(r, 1)[0]), s + 4));
    }
  }

  const triples = [], pairs = [], singles = [];
  for (let r = 2; r <= BIG_JOKER; r++) {
    let n = cnt(r);
    while (n >= 3) { triples.push(mk(TYPE.TRIPLE, take(r, 3), playValue(r, level))); n -= 3; }
    while (n >= 2) { pairs.push(mk(TYPE.PAIR, take(r, 2), playValue(r, level))); n -= 2; }
    while (n >= 1) { singles.push(mk(TYPE.SINGLE, take(r, 1), playValue(r, level))); n -= 1; }
  }

  // A triple carries a spare pair along for free.
  while (triples.length && pairs.length) {
    const t = triples.shift();
    const p = pairs.pop();
    plays.push(mk(TYPE.FULLHOUSE, t.cards.concat(p.cards), t.rank, { attached: p.cards[0].rank }));
  }
  plays.push(...triples, ...pairs);

  // Spend wildcards where they save the most turns.
  for (const w of wilds) {
    const upgradeable = plays.find((p) => p.type === TYPE.TRIPLE);
    const single = singles.find((s) => !isJoker(s.cards[0]));
    if (upgradeable) {
      upgradeable.type = TYPE.BOMB;
      upgradeable.cards.push(w);
    } else if (single) {
      single.type = TYPE.PAIR;
      single.cards.push(w);
      plays.push(single);
      singles.splice(singles.indexOf(single), 1);
    } else {
      plays.push(mk(TYPE.SINGLE, [w], playValue(level, level)));
    }
  }
  plays.push(...singles);

  return { plays, count: plays.length, level };
}

/** Cards that tend to win a trick outright. */
export function controlCount(hand, level) {
  return hand.filter((c) => isWild(c, level) || c.rank === level || isJoker(c) || c.rank === 14).length;
}

export function bombCount(hand, level) {
  return decompose(hand, level).plays.filter(
    (p) => p.type === TYPE.BOMB || p.type === TYPE.ROCKET || p.type === TYPE.STRAIGHT_FLUSH).length;
}

/** Rough static strength; higher is better. Used for tie-breaking, not search. */
export function handStrength(hand, level) {
  const d = decompose(hand, level);
  const bombs = d.plays.filter((p) => p.type === TYPE.BOMB || p.type === TYPE.ROCKET).length;
  return -8 * d.count + 3 * controlCount(hand, level) + 12 * bombs - 0.2 * hand.length;
}

/** Which structures in `hand` would this set of cards tear apart? */
export function brokenStructures(hand, cards, level) {
  const played = new Set(cards.map((c) => c.id));
  const { plays } = decompose(hand, level);
  const broken = [];
  for (const p of plays) {
    if (p.cards.length < 2) continue;
    const hit = p.cards.filter((c) => played.has(c.id)).length;
    if (hit > 0 && hit < p.cards.length) broken.push(p);
  }
  return broken;
}
