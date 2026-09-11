// Guandan match state machine: deals, tricks, tribute, level progression.
import { makeDeck, shuffle, isWild, playValue, sortHand, BIG_JOKER } from './cards.js';
import { identify, identifyAll, beats, isBomb } from './combos.js';
import { legalMoves, removeCards } from './moves.js';

export const teamOf = (seat) => seat % 2;
export const partnerOf = (seat) => (seat + 2) % 4;
export const seatsOfTeam = (team) => [team, team + 2];

export const PHASE = {
  TRIBUTE: 'tribute',       // tribute cards owed
  RETURN: 'return',         // return cards owed
  PLAYING: 'playing',
  DEAL_OVER: 'dealOver',
  MATCH_OVER: 'matchOver',
};

const MAX_LEVEL = 14; // A
const A_ATTEMPTS_BEFORE_RESET = 3;

export class Game {
  constructor(opts = {}) {
    this.rng = opts.rng ?? Math.random;
    this.names = opts.names ?? ['You', 'West', 'North', 'East'];
    this.levels = [opts.startLevel ?? 2, opts.startLevel ?? 2];
    this.aAttempts = [0, 0];
    this.activeTeam = 0;          // team whose level is being played
    this.dealNumber = 0;
    this.lastFinishOrder = null;  // finishing order of the previous deal
    this.log = [];
    this.winner = null;
    this.phase = null;
    this.playedCards = new Set();
    this.known = [[], [], [], []];   // cards a seat is known to hold (from tribute)
  }

  get level() { return this.levels[this.activeTeam]; }

  // -- deal setup -----------------------------------------------------------

  startDeal() {
    this.dealNumber++;
    const deck = shuffle(makeDeck(), this.rng);
    this.hands = [0, 1, 2, 3].map((i) => sortHand(deck.slice(i * 27, i * 27 + 27), this.level));
    this.finished = [];
    this.tribute = null;
    this.trick = null;
    this.playedCards = new Set();
    this.known = [[], [], [], []];
    this.log.push({ kind: 'deal', deal: this.dealNumber, level: this.level, levels: this.levels.slice() });
    this.setupTribute();
    return this;
  }

  setupTribute() {
    const order = this.lastFinishOrder;
    if (!order) {
      this.beginPlay(Math.floor(this.rng() * 4));
      return;
    }
    const [first, second, third, fourth] = order;
    const doubleDown = teamOf(first) === teamOf(second);
    const payers = doubleDown ? [third, fourth] : [fourth];

    const bigJokers = payers.reduce(
      (n, s) => n + this.hands[s].filter((c) => c.rank === BIG_JOKER).length, 0);
    if (bigJokers >= 2) {
      this.log.push({ kind: 'resist', seats: payers.slice() });
      this.beginPlay(first);
      return;
    }

    const offers = payers.map((seat) => ({ seat, card: highestTributeCard(this.hands[seat], this.level) }))
      .filter((o) => o.card);
    if (!offers.length) { this.beginPlay(first); return; }

    // In a double loss the bigger tribute goes to the first-place player.
    offers.sort((a, b) => playValue(b.card.rank, this.level) - playValue(a.card.rank, this.level));
    const receivers = doubleDown ? [first, second] : [first];
    const pairs = offers.map((o, i) => ({ from: o.seat, to: receivers[i], card: o.card }))
      .filter((p) => p.to != null);

    for (const p of pairs) {
      this.hands[p.from] = removeCards(this.hands[p.from], [p.card]);
      this.hands[p.to] = sortHand(this.hands[p.to].concat([p.card]), this.level);
      this.known[p.to].push(p.card.id);
      this.log.push({ kind: 'tribute', from: p.from, to: p.to, card: p.card });
    }

    // Whoever paid tribute to the first-place player leads the new deal.
    this.tribute = { pairs, leader: pairs[0].from, pending: pairs.map((p) => p.to) };
    this.phase = PHASE.RETURN;
  }

  /** Return a card (rank 10 or lower) to the player who paid tribute. */
  returnCard(seat, card) {
    if (this.phase !== PHASE.RETURN) throw new Error('not in the return phase');
    const pair = this.tribute.pairs.find((p) => p.to === seat);
    if (!pair) throw new Error(`seat ${seat} owes no return`);
    const hasLow = this.hands[seat].some((c) => c.rank <= 10);
    if (card.rank > 10 && hasLow) throw new Error('a return card must be 10 or lower');
    if (!this.hands[seat].some((c) => c.id === card.id)) throw new Error('card not in hand');
    this.hands[seat] = removeCards(this.hands[seat], [card]);
    this.hands[pair.from] = sortHand(this.hands[pair.from].concat([card]), this.level);
    this.known[pair.from].push(card.id);
    this.log.push({ kind: 'return', from: seat, to: pair.from, card });
    this.tribute.pending = this.tribute.pending.filter((s) => s !== seat);
    if (!this.tribute.pending.length) this.beginPlay(this.tribute.leader);
    return this;
  }

  /** Lowest card of rank 10 or lower — the default return choice. */
  autoReturnCard(seat) {
    const eligible = this.hands[seat].filter((c) => c.rank <= 10 && !isWild(c, this.level));
    const pool = eligible.length ? eligible
      : this.hands[seat].filter((c) => c.rank <= 10).length ? this.hands[seat].filter((c) => c.rank <= 10)
      : this.hands[seat];
    if (!pool.length) return null;
    return pool.reduce((lo, c) => (playValue(c.rank, this.level) < playValue(lo.rank, this.level) ? c : lo));
  }

  beginPlay(leader) {
    this.phase = PHASE.PLAYING;
    this.current = leader;
    this.trick = { target: null, winner: null, leader, passed: new Set(), plays: [] };
    this.log.push({ kind: 'lead', seat: leader });
  }

  // -- play -----------------------------------------------------------------

  activeSeats() { return [0, 1, 2, 3].filter((s) => !this.finished.includes(s)); }
  isActive(seat) { return !this.finished.includes(seat); }

  legalFor(seat) {
    return legalMoves(this.hands[seat], this.level, this.trick?.target ?? null);
  }

  canPass(seat) { return !!this.trick?.target; }

  play(seat, combo, opts = {}) {
    this.assertTurn(seat);
    if (!combo) return this.pass(seat);
    if (opts.validate !== false) {
      const ids = new Set(this.hands[seat].map((c) => c.id));
      if (!combo.cards.every((c) => ids.has(c.id))) throw new Error('played a card not in hand');
      // Validate the combination itself rather than matching against generated
      // moves: two different copies of the same rank are equally legal.
      const reading = identifyAll(combo.cards, this.level).find(
        (r) => r.type === combo.type && r.rank === combo.rank);
      if (!reading) throw new Error('those cards are not a legal combination');
      if (!beats(reading, this.trick.target)) throw new Error('that does not beat the current play');
    }

    this.hands[seat] = removeCards(this.hands[seat], combo.cards);
    for (const c of combo.cards) this.playedCards.add(c.id);
    this.trick.target = combo;
    this.trick.winner = seat;
    this.trick.passed = new Set();
    this.trick.plays.push({ seat, combo });
    this.log.push({ kind: 'play', seat, combo, remaining: this.hands[seat].length });

    if (this.hands[seat].length === 0) this.finish(seat);
    this.advance();
    return this;
  }

  pass(seat) {
    this.assertTurn(seat);
    if (!this.trick.target) throw new Error('cannot pass on a free lead');
    this.trick.passed.add(seat);
    this.trick.plays.push({ seat, combo: null });
    this.log.push({ kind: 'pass', seat });
    this.advance();
    return this;
  }

  assertTurn(seat) {
    if (this.phase !== PHASE.PLAYING) throw new Error(`not playing (phase ${this.phase})`);
    if (seat !== this.current) throw new Error(`not seat ${seat}'s turn`);
  }

  finish(seat) {
    this.finished.push(seat);
    this.log.push({ kind: 'out', seat, place: this.finished.length });
  }

  advance() {
    if (this.checkDealOver()) return;
    if (this.trickComplete()) { this.endTrick(); return; }
    this.current = this.nextActive(this.current);
  }

  trickComplete() {
    if (!this.trick.target) return false;
    const others = this.activeSeats().filter((s) => s !== this.trick.winner);
    return others.length > 0 && others.every((s) => this.trick.passed.has(s));
  }

  endTrick() {
    const winner = this.trick.winner;
    let leader;
    if (this.isActive(winner)) {
      leader = winner;
    } else if (this.isActive(partnerOf(winner))) {
      // 接风: the partner of a player who went out takes the free lead.
      leader = partnerOf(winner);
      this.log.push({ kind: 'jiefeng', seat: leader, from: winner });
    } else {
      leader = this.nextActive(winner);
    }
    this.beginPlay(leader);
  }

  nextActive(from) {
    for (let i = 1; i <= 4; i++) {
      const s = (from + i) % 4;
      if (this.isActive(s)) return s;
    }
    return from;
  }

  checkDealOver() {
    const t0 = this.finished.filter((s) => teamOf(s) === 0).length;
    const t1 = this.finished.filter((s) => teamOf(s) === 1).length;
    if (t0 < 2 && t1 < 2 && this.finished.length < 3) return false;
    this.endDeal();
    return true;
  }

  endDeal() {
    const order = this.finished.slice();
    for (const s of [0, 1, 2, 3]) if (!order.includes(s)) order.push(s);
    this.lastFinishOrder = order;

    const winTeam = teamOf(order[0]);
    const partnerPlace = order.indexOf(partnerOf(order[0])); // 1, 2 or 3
    const gain = partnerPlace === 1 ? 3 : partnerPlace === 2 ? 2 : 1;

    const before = this.levels[winTeam];
    const result = { order, winTeam, gain, before, deal: this.dealNumber };

    if (before === MAX_LEVEL) {
      this.levels[winTeam] = MAX_LEVEL;
      this.winner = winTeam;
      this.phase = PHASE.MATCH_OVER;
      result.matchWon = true;
    } else {
      this.levels[winTeam] = Math.min(MAX_LEVEL, before + gain);
      this.phase = PHASE.DEAL_OVER;
    }

    // A team sitting at A that fails to close it out three times falls back to 2.
    const loseTeam = 1 - winTeam;
    if (this.levels[loseTeam] === MAX_LEVEL) {
      this.aAttempts[loseTeam]++;
      if (this.aAttempts[loseTeam] >= A_ATTEMPTS_BEFORE_RESET) {
        this.levels[loseTeam] = 2;
        this.aAttempts[loseTeam] = 0;
        result.resetTeam = loseTeam;
      }
    }
    if (this.levels[winTeam] !== MAX_LEVEL) this.aAttempts[winTeam] = 0;

    this.activeTeam = winTeam;
    this.result = result;
    this.log.push({ kind: 'dealOver', ...result, levels: this.levels.slice() });
    return result;
  }
}

/** Highest card a player must hand over as tribute; ♥ level cards are exempt. */
export function highestTributeCard(hand, level) {
  const pool = hand.filter((c) => !isWild(c, level));
  if (!pool.length) return null;
  return pool.reduce((hi, c) => (playValue(c.rank, level) > playValue(hi.rank, level) ? c : hi));
}
