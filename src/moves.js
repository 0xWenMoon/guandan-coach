// Legal move generation.
import { isJoker, isWild, playValue, SMALL_JOKER, BIG_JOKER, SUITS } from './cards.js';
import {
  TYPE, isBomb, bombTier, beats, identifyAll, STRAIGHT_LEN, TUBE_PAIRS, PLATE_TRIPLES, seqRank,
} from './combos.js';

export function indexHand(hand, level) {
  const wilds = [];
  const byRank = new Map();
  const bySuitRank = new Map(); // `${suit}${rank}` -> cards
  for (const c of hand) {
    if (isWild(c, level)) { wilds.push(c); continue; }
    if (!byRank.has(c.rank)) byRank.set(c.rank, []);
    byRank.get(c.rank).push(c);
    if (!isJoker(c)) {
      const k = c.suit + c.rank;
      if (!bySuitRank.has(k)) bySuitRank.set(k, []);
      bySuitRank.get(k).push(c);
    }
  }
  return { hand, level, wilds, byRank, bySuitRank, count: (r) => (byRank.get(r)?.length ?? 0) };
}

/** Assemble a concrete play for a shape, spending wildcards only where needed. */
function build(idx, slots, type, rank, extra = {}) {
  const used = [];
  const taken = new Map();
  let needWild = 0;
  for (const [r, k, suit] of slots) {
    const pool = suit ? (idx.bySuitRank.get(suit + r) ?? []) : (idx.byRank.get(r) ?? []);
    const already = taken.get(suit ? suit + r : r) ?? 0;
    const got = Math.min(k, pool.length - already);
    for (let i = 0; i < got; i++) used.push(pool[already + i]);
    taken.set(suit ? suit + r : r, already + got);
    needWild += k - got;
  }
  if (needWild > idx.wilds.length) return null;
  for (let i = 0; i < needWild; i++) used.push(idx.wilds[i]);
  return { type, rank, cards: used, wilds: needWild, ...extra };
}

const NORMAL_RANKS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

function seqSlots(start, span, per) {
  const slots = [];
  for (let i = 0; i < span; i++) slots.push([seqRank(start + i), per]);
  return slots;
}

// --- generators ------------------------------------------------------------

function genRankPlays(idx, size, type, minRank) {
  const out = [];
  const ranks = NORMAL_RANKS.concat([SMALL_JOKER, BIG_JOKER]);
  for (const r of ranks) {
    const value = playValue(r, idx.level);
    if (minRank != null && value <= minRank) continue;
    const have = idx.count(r);
    if (have >= size) { out.push(build(idx, [[r, size]], type, value)); continue; }
    if (r >= SMALL_JOKER) continue;             // wildcards cannot become jokers
    // A wildcard substitutes INSIDE a combination; on its own it is simply the
    // level card, so it can never be declared as a lone card of another rank.
    if (size === 1) continue;
    if (have + idx.wilds.length >= size) out.push(build(idx, [[r, size]], type, value));
  }
  if (size === 1 && idx.wilds.length) {
    const value = playValue(idx.level, idx.level);
    if (minRank == null || value > minRank) {
      out.push({ type, rank: value, cards: [idx.wilds[0]], wilds: 1 });
    }
  }
  return out.filter(Boolean);
}

function genFullHouses(idx, minRank) {
  const out = [];
  for (const t of NORMAL_RANKS) {
    const value = playValue(t, idx.level);
    if (minRank != null && value <= minRank) continue;
    for (const p of NORMAL_RANKS) {
      if (p === t) continue;
      const need = Math.max(0, 3 - idx.count(t)) + Math.max(0, 2 - idx.count(p));
      if (need > idx.wilds.length) continue;
      const play = build(idx, [[t, 3], [p, 2]], TYPE.FULLHOUSE, value, { attached: p });
      if (play) out.push(play);
    }
  }
  return out;
}

function genSequence(idx, span, per, type, minRank) {
  const out = [];
  for (let s = 1; s + span - 1 <= 14; s++) {
    const top = s + span - 1;
    if (minRank != null && top <= minRank) continue;
    const slots = seqSlots(s, span, per);
    let need = 0;
    for (const [r, k] of slots) need += Math.max(0, k - idx.count(r));
    if (need > idx.wilds.length) continue;
    const play = build(idx, slots, type, top);
    if (play) out.push(play);
  }
  return out;
}

function genStraightFlushes(idx, minTier, minRank) {
  const out = [];
  if (minTier != null && minTier > 6) return out;
  for (const suit of SUITS) {
    for (let s = 1; s + STRAIGHT_LEN - 1 <= 14; s++) {
      const top = s + STRAIGHT_LEN - 1;
      if (minTier === 6 && minRank != null && top <= minRank) continue;
      const slots = [];
      let need = 0;
      for (let i = 0; i < STRAIGHT_LEN; i++) {
        const r = seqRank(s + i);
        slots.push([r, 1, suit]);
        if ((idx.bySuitRank.get(suit + r)?.length ?? 0) < 1) need++;
      }
      if (need > idx.wilds.length) continue;
      const play = build(idx, slots, TYPE.STRAIGHT_FLUSH, top, { suit });
      if (play) out.push(play);
    }
  }
  return out;
}

function genBombs(idx, target) {
  const out = [];
  const tier = target && isBomb(target) ? bombTier(target) : 0;
  const tRank = target && isBomb(target) ? target.rank : -Infinity;

  for (const r of NORMAL_RANKS) {
    const have = idx.count(r);
    const max = have + idx.wilds.length;
    const value = playValue(r, idx.level);
    for (let n = 4; n <= max; n++) {
      const myTier = n <= 5 ? n : n + 1;
      if (myTier < tier) continue;
      if (myTier === tier && value <= tRank) continue;
      const play = build(idx, [[r, n]], TYPE.BOMB, value);
      if (play) out.push(play);
    }
  }
  for (const sf of genStraightFlushes(idx, tier, tRank)) {
    if (6 < tier) continue;
    if (6 === tier && sf.rank <= tRank) continue;
    out.push(sf);
  }
  if (tier < 100 && idx.count(SMALL_JOKER) >= 2 && idx.count(BIG_JOKER) >= 2) {
    const play = build(idx, [[SMALL_JOKER, 2], [BIG_JOKER, 2]], TYPE.ROCKET, 1000);
    if (play) out.push(play);
  }
  return out;
}

// --- public API ------------------------------------------------------------

/**
 * All legal plays from `hand`. With `target` null this is a free lead;
 * otherwise only plays that beat `target` are returned.
 */
export function legalMoves(hand, level, target = null) {
  const idx = indexHand(hand, level);
  const out = [];

  if (!target) {
    out.push(...genRankPlays(idx, 1, TYPE.SINGLE, null));
    out.push(...genRankPlays(idx, 2, TYPE.PAIR, null));
    out.push(...genRankPlays(idx, 3, TYPE.TRIPLE, null));
    out.push(...genFullHouses(idx, null));
    out.push(...genSequence(idx, STRAIGHT_LEN, 1, TYPE.STRAIGHT, null));
    out.push(...genSequence(idx, TUBE_PAIRS, 2, TYPE.TUBE, null));
    out.push(...genSequence(idx, PLATE_TRIPLES, 3, TYPE.PLATE, null));
    out.push(...genBombs(idx, null));
  } else if (isBomb(target)) {
    out.push(...genBombs(idx, target));
  } else {
    const min = target.rank;
    switch (target.type) {
      case TYPE.SINGLE: out.push(...genRankPlays(idx, 1, TYPE.SINGLE, min)); break;
      case TYPE.PAIR: out.push(...genRankPlays(idx, 2, TYPE.PAIR, min)); break;
      case TYPE.TRIPLE: out.push(...genRankPlays(idx, 3, TYPE.TRIPLE, min)); break;
      case TYPE.FULLHOUSE: out.push(...genFullHouses(idx, min)); break;
      case TYPE.STRAIGHT: out.push(...genSequence(idx, STRAIGHT_LEN, 1, TYPE.STRAIGHT, min)); break;
      case TYPE.TUBE: out.push(...genSequence(idx, TUBE_PAIRS, 2, TYPE.TUBE, min)); break;
      case TYPE.PLATE: out.push(...genSequence(idx, PLATE_TRIPLES, 3, TYPE.PLATE, min)); break;
    }
    out.push(...genBombs(idx, target));
  }

  return dedupePlays(out.filter((p) => p && p.cards.length));
}

/**
 * Collapse plays that are strategically identical, keeping the one that
 * spends the fewest wildcards.
 */
function dedupePlays(plays) {
  const best = new Map();
  for (const p of plays) {
    const key = `${p.type}|${p.rank}|${p.cards.length}|${p.attached ?? ''}|${p.suit ?? ''}`;
    const cur = best.get(key);
    if (!cur || p.wilds < cur.wilds) best.set(key, p);
  }
  return [...best.values()];
}

/** Fast "is there anything at all I could play here?" */
export function canBeat(hand, level, target) {
  if (!target) return hand.length > 0;
  return legalMoves(hand, level, target).length > 0;
}

export function removeCards(hand, cards) {
  const drop = new Set(cards.map((c) => c.id));
  return hand.filter((c) => !drop.has(c.id));
}

/**
 * Pick how a player's selected cards should be read. Prefers the WEAKEST
 * reading that still beats the target, so selecting five cards of one suit
 * does not silently spend a straight flush when a plain straight suffices.
 */
export function readingFor(cards, level, target) {
  const readings = identifyAll(cards, level);
  if (!readings.length) return { error: 'those cards are not a legal combination' };
  const playable = readings.filter((r) => beats(r, target));
  if (!playable.length) {
    return { error: 'that is a legal combination, but it does not beat the current play', readings };
  }
  const weakest = playable[playable.length - 1];
  return { combo: weakest, alternatives: playable };
}
