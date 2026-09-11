// Guandan combination types, wildcard resolution, and comparison ordering.
import { isJoker, isWild, playValue, SMALL_JOKER, BIG_JOKER, SUITS, RANK_LABEL, SUIT_SYMBOL } from './cards.js';

export const TYPE = {
  SINGLE: 'single',
  PAIR: 'pair',
  TRIPLE: 'triple',
  FULLHOUSE: 'fullhouse',   // 三带二
  STRAIGHT: 'straight',     // 顺子, exactly 5
  TUBE: 'tube',             // 木板 / 三连对, 3 consecutive pairs
  PLATE: 'plate',           // 钢板, 2 consecutive triples
  BOMB: 'bomb',             // 炸弹, 4+ of a kind
  STRAIGHT_FLUSH: 'straightflush', // 同花顺
  ROCKET: 'rocket',         // 四大天王
};

export const TYPE_NAME = {
  single: 'single', pair: 'pair', triple: 'triple', fullhouse: 'full house',
  straight: 'straight', tube: 'three consecutive pairs', plate: 'consecutive triples',
  bomb: 'bomb', straightflush: 'straight flush', rocket: 'four kings',
};

export const TYPE_CN = {
  single: '单牌', pair: '对子', triple: '三同张', fullhouse: '三带二',
  straight: '顺子', tube: '木板', plate: '钢板',
  bomb: '炸弹', straightflush: '同花顺', rocket: '四大天王',
};

export const BOMB_TYPES = new Set([TYPE.BOMB, TYPE.STRAIGHT_FLUSH, TYPE.ROCKET]);
export function isBomb(combo) { return !!combo && BOMB_TYPES.has(combo.type); }

/**
 * Bomb strength tier. Ordering:
 *   4-bomb < 5-bomb < straight flush < 6-bomb < 7-bomb < ... < four kings
 */
export function bombTier(combo) {
  if (combo.type === TYPE.ROCKET) return 100;
  if (combo.type === TYPE.STRAIGHT_FLUSH) return 6;
  const n = combo.cards.length;
  return n <= 5 ? n : n + 1;
}

// ---------------------------------------------------------------------------
// Sequence shapes. Rank 1 means "A played low" (A2345, AA2233, AAA222).
// ---------------------------------------------------------------------------
const seqRank = (r) => (r === 1 ? 14 : r);

export const STRAIGHT_LEN = 5;
export const TUBE_PAIRS = 3;
export const PLATE_TRIPLES = 2;

function sequenceStarts(span) {
  const starts = [];
  for (let s = 1; s + span - 1 <= 14; s++) starts.push(s);
  return starts;
}

// ---------------------------------------------------------------------------
// Fitting a concrete hand-slice + wildcards onto a required shape.
// ---------------------------------------------------------------------------

/** slots: [[rank, count], ...]. Returns wildcards needed, or -1 if impossible. */
function deficitFor(slots, counts, concreteTotal, wilds, opts = {}) {
  let used = 0, deficit = 0;
  for (const [rank, need] of slots) {
    const avail = counts.get(rank) ?? 0;
    const take = Math.min(avail, need);
    used += take;
    const short = need - take;
    // A wildcard is a ♥ level card: it can never stand in for a joker.
    if (short > 0 && rank >= SMALL_JOKER) return -1;
    deficit += short;
  }
  if (deficit > wilds) return -1;
  if (opts.exact && used !== concreteTotal) return -1; // every selected card must be used
  if (opts.exact && deficit !== wilds) return -1;      // every selected wildcard must be used
  return deficit;
}

function countsOf(cards) {
  const m = new Map();
  for (const c of cards) m.set(c.rank, (m.get(c.rank) ?? 0) + 1);
  return m;
}

// ---------------------------------------------------------------------------
// identifyAll: every legal reading of an exact set of selected cards.
// ---------------------------------------------------------------------------

/**
 * Returns all valid combos that the given cards can form, strongest first.
 * A selection can be ambiguous when wildcards are involved (e.g. 3 3 3 + ♥level
 * is both a four-bomb and, with another card, a full house), so the caller
 * picks the reading it wants.
 */
export function identifyAll(cards, level) {
  const wildCards = cards.filter((c) => isWild(c, level));
  const concrete = cards.filter((c) => !isWild(c, level));
  const w = wildCards.length;
  const n = cards.length;
  const counts = countsOf(concrete);
  const out = [];

  const push = (type, rank, slots, extra = {}) => {
    const d = deficitFor(slots, counts, concrete.length, w, { exact: true });
    if (d < 0) return;
    out.push({ type, rank, cards: cards.slice(), wilds: w, ...extra });
  };

  const ranksInPlay = () => {
    const rs = new Set(counts.keys());
    if (w > 0) for (let r = 2; r <= 14; r++) rs.add(r);
    return [...rs];
  };

  if (n === 1) {
    const c = cards[0];
    // A lone wildcard is played as its natural level card.
    push(TYPE.SINGLE, playValue(c.rank, level), [[c.rank, 1]]);
  }

  if (n === 2) {
    for (const r of ranksInPlay()) push(TYPE.PAIR, playValue(r, level), [[r, 2]]);
    for (const r of [SMALL_JOKER, BIG_JOKER]) push(TYPE.PAIR, playValue(r, level), [[r, 2]]);
  }

  if (n === 3) {
    for (const r of ranksInPlay()) push(TYPE.TRIPLE, playValue(r, level), [[r, 3]]);
  }

  if (n === 5) {
    // Full house: triple ranks the combo, attached pair is free.
    for (const t of ranksInPlay()) {
      for (const p of ranksInPlay()) {
        if (p === t) continue;
        push(TYPE.FULLHOUSE, playValue(t, level), [[t, 3], [p, 2]], { attached: p });
      }
    }
    // Straight (5 consecutive, natural ranks, no jokers).
    for (const s of sequenceStarts(STRAIGHT_LEN)) {
      const slots = [];
      for (let i = 0; i < STRAIGHT_LEN; i++) slots.push([seqRank(s + i), 1]);
      push(TYPE.STRAIGHT, s + STRAIGHT_LEN - 1, slots);
      // Straight flush: same shape, one suit.
      const suits = new Set(concrete.map((c) => c.suit));
      if (concrete.every((c) => !isJoker(c)) && suits.size <= 1) {
        const suit = concrete.length ? concrete[0].suit : 'S';
        push(TYPE.STRAIGHT_FLUSH, s + STRAIGHT_LEN - 1, slots, { suit });
      }
    }
  }

  if (n === 6) {
    for (const s of sequenceStarts(TUBE_PAIRS)) {
      const slots = [];
      for (let i = 0; i < TUBE_PAIRS; i++) slots.push([seqRank(s + i), 2]);
      push(TYPE.TUBE, s + TUBE_PAIRS - 1, slots);
    }
    for (const s of sequenceStarts(PLATE_TRIPLES)) {
      const slots = [];
      for (let i = 0; i < PLATE_TRIPLES; i++) slots.push([seqRank(s + i), 3]);
      push(TYPE.PLATE, s + PLATE_TRIPLES - 1, slots);
    }
  }

  if (n >= 4) {
    for (const r of ranksInPlay()) push(TYPE.BOMB, playValue(r, level), [[r, n]]);
  }

  if (n === 4 && w === 0) {
    push(TYPE.ROCKET, 1000, [[SMALL_JOKER, 2], [BIG_JOKER, 2]]);
  }

  // Strongest reading first.
  out.sort((a, b) => rankKey(b) - rankKey(a));
  return dedupe(out);
}

function dedupe(combos) {
  const seen = new Set();
  return combos.filter((c) => {
    const k = `${c.type}|${c.rank}|${c.attached ?? ''}|${c.suit ?? ''}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function rankKey(c) {
  return (isBomb(c) ? 1000 + bombTier(c) * 100 : 0) + c.rank;
}

/** The single best reading of a selection, or null if it isn't a legal combo. */
export function identify(cards, level) {
  return identifyAll(cards, level)[0] ?? null;
}

// ---------------------------------------------------------------------------
// Comparison
// ---------------------------------------------------------------------------

/** Can `play` legally be put on top of `target`? A null target means a free lead. */
export function beats(play, target) {
  if (!play) return false;
  if (!target) return true;
  const pb = isBomb(play), tb = isBomb(target);
  if (pb && !tb) return true;
  if (!pb && tb) return false;
  if (pb && tb) {
    const pt = bombTier(play), tt = bombTier(target);
    if (pt !== tt) return pt > tt;
    return play.rank > target.rank;
  }
  if (play.type !== target.type) return false;
  if (play.cards.length !== target.cards.length) return false;
  return play.rank > target.rank;
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

function rankName(value, level) {
  if (value === 16) return 'big joker';
  if (value === 15) return 'small joker';
  if (value === 14.5) return `${RANK_LABEL[level]}s (level card)`;
  return RANK_LABEL[value] ?? String(value);
}

export function describeCombo(combo, level) {
  if (!combo) return 'pass';
  const top = combo.rank;
  switch (combo.type) {
    case TYPE.SINGLE: return `single ${rankName(top, level)}`;
    case TYPE.PAIR: return `pair of ${rankName(top, level)}`;
    case TYPE.TRIPLE: return `triple ${rankName(top, level)}`;
    case TYPE.FULLHOUSE: return `full house, ${rankName(top, level)} over ${RANK_LABEL[combo.attached]}`;
    case TYPE.STRAIGHT: return `straight to ${RANK_LABEL[seqRank(top)]}`;
    case TYPE.TUBE: return `three consecutive pairs to ${RANK_LABEL[seqRank(top)]}`;
    case TYPE.PLATE: return `consecutive triples to ${RANK_LABEL[seqRank(top)]}`;
    case TYPE.BOMB: return `${combo.cards.length}-card bomb of ${rankName(top, level)}`;
    case TYPE.STRAIGHT_FLUSH: return `straight flush to ${RANK_LABEL[seqRank(top)]}${combo.suit ? ' ' + SUIT_SYMBOL[combo.suit] : ''}`;
    case TYPE.ROCKET: return 'four kings';
    default: return combo.type;
  }
}

export { deficitFor, countsOf, sequenceStarts, seqRank };
