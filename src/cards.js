// Card model for Guandan (掼蛋).
// Two standard decks = 108 cards. Ranks 2..14 (14 = A), plus jokers.

export const SUITS = ['S', 'H', 'C', 'D'];
export const SUIT_SYMBOL = { S: '♠', H: '♥', C: '♣', D: '♦', J: '★' };
export const SUIT_NAME = { S: 'spades', H: 'hearts', C: 'clubs', D: 'diamonds', J: 'joker' };

export const SMALL_JOKER = 15;
export const BIG_JOKER = 16;

export const RANK_LABEL = {
  2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10',
  11: 'J', 12: 'Q', 13: 'K', 14: 'A', 15: 'w', 16: 'W',
};

// Levels a team can be at, in order. 14 = A is the final level.
export const LEVELS = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];

export function isJoker(card) {
  return card.rank >= SMALL_JOKER;
}

/** The two ♥ cards of the current level are wildcards (逢人配). */
export function isWild(card, level) {
  return card.suit === 'H' && card.rank === level;
}

/**
 * Rank used when comparing singles / pairs / triples / bombs.
 * The level card outranks A but sits below the jokers.
 */
export function playValue(rank, level) {
  if (rank === SMALL_JOKER) return 15;
  if (rank === BIG_JOKER) return 16;
  if (rank === level) return 14.5;
  return rank;
}

/** Rank used inside straights / consecutive pairs / consecutive triples: always natural. */
export function naturalRank(card) {
  return card.rank;
}

export function makeDeck() {
  const cards = [];
  for (let copy = 0; copy < 2; copy++) {
    for (const suit of SUITS) {
      for (let rank = 2; rank <= 14; rank++) {
        cards.push({ id: `${rank}${suit}${copy}`, rank, suit });
      }
    }
    cards.push({ id: `${SMALL_JOKER}J${copy}`, rank: SMALL_JOKER, suit: 'J' });
    cards.push({ id: `${BIG_JOKER}J${copy}`, rank: BIG_JOKER, suit: 'J' });
  }
  return cards;
}

export function shuffle(cards, rng = Math.random) {
  const a = cards.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export function cardLabel(card) {
  if (isJoker(card)) return card.rank === BIG_JOKER ? 'BJ' : 'SJ';
  return SUIT_SYMBOL[card.suit] + RANK_LABEL[card.rank];
}

export function handLabel(cards) {
  return cards.map(cardLabel).join(' ');
}

/** Sort for display: by play value descending, wildcards first within their rank. */
export function sortHand(cards, level) {
  return cards.slice().sort((a, b) => {
    const d = playValue(b.rank, level) - playValue(a.rank, level);
    if (d !== 0) return d;
    const aw = isWild(a, level) ? 1 : 0;
    const bw = isWild(b, level) ? 1 : 0;
    if (aw !== bw) return bw - aw;
    return SUITS.indexOf(a.suit) - SUITS.indexOf(b.suit);
  });
}

/** Parse a compact test notation like "SA HK C10 sj bj" into cards. */
export function parseCards(text) {
  const out = [];
  const seen = {};
  for (const tok of text.trim().split(/\s+/).filter(Boolean)) {
    let rank, suit;
    if (/^sj$/i.test(tok)) { rank = SMALL_JOKER; suit = 'J'; }
    else if (/^bj$/i.test(tok)) { rank = BIG_JOKER; suit = 'J'; }
    else {
      suit = tok[0].toUpperCase();
      const r = tok.slice(1).toUpperCase();
      rank = r === 'A' ? 14 : r === 'K' ? 13 : r === 'Q' ? 12 : r === 'J' ? 11 : parseInt(r, 10);
      if (!SUITS.includes(suit) || !(rank >= 2 && rank <= 14)) throw new Error(`bad card: ${tok}`);
    }
    const key = `${rank}${suit}`;
    const copy = seen[key] = (seen[key] ?? -1) + 1;
    out.push({ id: `${key}${copy}`, rank, suit });
  }
  return out;
}
