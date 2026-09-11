// What a player can legitimately work out from the table.
//
// Guandan is a counting game: strong players track which cards are gone, which
// ranks are still whole (and therefore still bomb material), and whether the
// card they are about to play can actually be beaten any more. All of this is
// derivable from public information — your own hand plus everything played.
import { makeDeck, playValue, RANK_LABEL, SMALL_JOKER, BIG_JOKER, isWild } from './cards.js';
import { decompose } from './eval.js';
import { teamOf, partnerOf } from './game.js';

const RANK_OF_ID = new Map(makeDeck().map((c) => [c.id, c.rank]));

const COPIES = (rank) => (rank >= SMALL_JOKER ? 2 : 8);

/** How many copies of each rank are unaccounted for, from `seat`'s point of view. */
export function outstanding(game, seat) {
  const left = new Map();
  for (let r = 2; r <= 14; r++) left.set(r, 8);
  left.set(SMALL_JOKER, 2);
  left.set(BIG_JOKER, 2);
  for (const c of game.hands[seat]) left.set(c.rank, left.get(c.rank) - 1);
  for (const id of game.playedCards) {
    const r = RANK_OF_ID.get(id);
    if (r != null) left.set(r, left.get(r) - 1);
  }
  for (const [r, n] of left) if (n < 0) left.set(r, 0);
  return left;
}

/** The best single anyone else could still be holding. */
export function highestOutstanding(left, level) {
  let best = null;
  for (const [rank, n] of left) {
    if (n <= 0) continue;
    const v = playValue(rank, level);
    if (!best || v > best.value) best = { rank, value: v, count: n };
  }
  return best;
}

/**
 * Ranks that could still be sitting outside as a bomb. The folk rule is that a
 * rank you hold none of is very likely to be a bomb somewhere (all eight copies
 * are unseen), and one you hold a single of is still a real risk.
 */
export function bombThreats(game, seat, left) {
  const mine = new Map();
  for (const c of game.hands[seat]) mine.set(c.rank, (mine.get(c.rank) ?? 0) + 1);
  const threats = [];
  for (const [rank, n] of left) {
    if (rank >= SMALL_JOKER || n < 4) continue;
    threats.push({ rank, outside: n, held: mine.get(rank) ?? 0 });
  }
  // A rank you hold none of, with every copy unseen, is the classic 断张 warning.
  threats.sort((a, b) => (b.outside - a.outside) || (a.held - b.held));
  return threats;
}

/** Ranks that are completely accounted for — nobody can hold one any more. */
export function exhaustedRanks(left) {
  return [...left].filter(([, n]) => n === 0).map(([rank]) => rank);
}

/**
 * Can this play still be beaten by an ordinary (non-bomb) card? Only meaningful
 * for singles and pairs, where "is my K the boss now?" is the live question.
 */
export function unbeatableExceptBombs(combo, left, level) {
  if (!combo) return false;
  if (combo.type !== 'single' && combo.type !== 'pair') return false;
  const need = combo.type === 'pair' ? 2 : 1;
  for (const [rank, n] of left) {
    if (n < need) continue;
    if (playValue(rank, level) > combo.rank) return false;
  }
  return true;
}

/** A plain-language read of how the hand is shaped. */
export function handPlan(hand, level) {
  const d = decompose(hand, level);
  const bombs = d.plays.filter(
    (p) => p.type === 'bomb' || p.type === 'rocket' || p.type === 'straightflush');
  const control = hand.filter(
    (c) => isWild(c, level) || c.rank === level || c.rank >= SMALL_JOKER || c.rank === 14).length;
  return { turns: d.count, plays: d.plays, bombs: bombs.length, control, cards: hand.length };
}

/** Who on the table is close to going out, and whose race is it. */
export function race(game, seat) {
  const me = game.hands[seat].length;
  const partner = game.isActive(partnerOf(seat)) ? game.hands[partnerOf(seat)].length : 0;
  const opponents = [0, 1, 2, 3]
    .filter((s) => teamOf(s) !== teamOf(seat) && game.isActive(s))
    .map((s) => ({ seat: s, cards: game.hands[s].length }))
    .sort((a, b) => a.cards - b.cards);
  const partnerOut = !game.isActive(partnerOf(seat));
  return {
    me,
    partner,
    partnerOut,
    opponents,
    // Your partner is better placed than you are, so your job is to feed them.
    supportPartner: !partnerOut && partner < me - 3,
    danger: opponents.length ? opponents[0] : null,
  };
}

export function label(rank) {
  if (rank === BIG_JOKER) return 'big joker';
  if (rank === SMALL_JOKER) return 'small joker';
  return RANK_LABEL[rank] ?? String(rank);
}
