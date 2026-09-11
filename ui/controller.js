// The game loop as an explicit state machine.
//
// Every asynchronous step records the engine generation it started in and
// refuses to touch the world if that generation has moved on, so a reply that
// arrives after "New match" (or a new deal) is discarded instead of being
// applied to a game it was never computed for.
import { Game, PHASE } from '../src/game.js';
import { sortHand } from '../src/cards.js';
import { snapshot } from '../src/serialize.js';
import { readingFor, legalMoves } from '../src/moves.js';
import { identify, describeCombo, TYPE } from '../src/combos.js';
import { EngineClient } from './engine-client.js';

export const UI = {
  BOOTING: 'booting',
  AWAITING_HUMAN: 'awaitingHuman',
  THINKING: 'thinking',
  RETURNING: 'returning',
  DEAL_OVER: 'dealOver',
  MATCH_OVER: 'matchOver',
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class Controller {
  constructor({ store, engine, human = 0, names, strength = () => ({}), delayMs = 280, onError = null }) {
    this.store = store;
    this.engine = engine;
    this.human = human;
    this.names = names;
    this.strength = strength;
    this.delayMs = delayMs;
    this.onError = onError;
    this.groupSeq = 0;
  }

  // -- lifecycle ------------------------------------------------------------

  newMatch(gameOptions = {}) {
    this.engine.reset();
    const game = new Game({ names: this.names, ...gameOptions });
    game.startDeal();
    this.store.set({
      game,
      phase: UI.BOOTING,
      selected: new Set(),
      thinkingSeat: null,
      coach: { status: 'idle' },
      stats: { moves: 0, best: 0, loss: 0 },
      groups: [],
      highlight: null,
      flushIndex: -1,
      version: 0,
    });
    this.advance();
  }

  nextDeal() {
    this.engine.reset();
    const { game } = this.store.get();
    game.startDeal();
    for (const s of [0, 1, 2, 3]) game.hands[s] = sortHand(game.hands[s], game.level);
    this.store.set({
      selected: new Set(), coach: { status: 'idle' }, thinkingSeat: null,
      groups: [], highlight: null, flushIndex: -1,
    });
    this.store.touch();
    this.advance();
  }

  /** Decide what the table should be doing, from the game's own phase. */
  advance() {
    const { game } = this.store.get();
    if (!game) return;
    switch (game.phase) {
      case PHASE.RETURN: return this.#handleReturn();
      case PHASE.DEAL_OVER: return void this.store.set({ phase: UI.DEAL_OVER, thinkingSeat: null });
      case PHASE.MATCH_OVER: return void this.store.set({ phase: UI.MATCH_OVER, thinkingSeat: null });
      case PHASE.PLAYING:
        if (game.current === this.human) {
          return void this.store.set({ phase: UI.AWAITING_HUMAN, thinkingSeat: null });
        }
        return void this.#botTurn();
      default:
        return;
    }
  }

  // -- bots -----------------------------------------------------------------

  async #botTurn() {
    const generation = this.engine.generation;
    const { game } = this.store.get();
    const seat = game.current;
    this.store.set({ phase: UI.THINKING, thinkingSeat: seat });

    let move = null;
    try {
      const reply = await this.engine.request('table', 'bot', {
        snap: snapshot(game, seat), seat, opts: this.strength(),
      });
      move = reply.move;
    } catch (err) {
      if (EngineClient.isStale(err)) return;
      this.onError?.(err);
    }

    if (!this.#current(generation, game)) return;
    if (this.delayMs) await sleep(this.delayMs);
    if (!this.#current(generation, game)) return;
    if (game.phase !== PHASE.PLAYING || game.current !== seat) return;

    try {
      this.#applyBotMove(game, seat, move);
    } catch (err) {
      this.onError?.(err);
      return;   // never re-throw into the loop; the table simply stops here
    }
    this.store.touch();
    this.advance();
  }

  /** Is this still the game and generation we started thinking about? */
  #current(generation, game) {
    return this.engine.generation === generation && this.store.get().game === game;
  }

  #applyBotMove(game, seat, move) {
    const hand = game.hands[seat];
    const cards = move ? move.cards.map((c) => hand.find((x) => x.id === c.id)) : null;
    if (cards && cards.every(Boolean)) {
      try {
        game.play(seat, { ...move, cards });
        return;
      } catch (err) {
        this.onError?.(err);   // fall through to something legal
      }
    }
    if (game.trick.target) { game.pass(seat); return; }
    const legal = game.legalFor(seat);
    if (legal.length) game.play(seat, legal[0]);
  }

  // -- your turn ------------------------------------------------------------

  toggleCard(id) {
    const { selected, phase } = this.store.get();
    if (phase !== UI.AWAITING_HUMAN) return;
    const next = new Set(selected);
    next.has(id) ? next.delete(id) : next.add(id);
    this.store.set({ selected: next });
  }

  clearSelection() { this.store.set({ selected: new Set(), highlight: null, flushIndex: -1 }); }

  /** What the current selection would be played as, or why it cannot be. */
  reading() {
    const { game, selected } = this.store.get();
    if (!game || !selected.size) return null;
    const cards = game.hands[this.human].filter((c) => selected.has(c.id));
    return readingFor(cards, game.level, game.trick?.target ?? null);
  }

  playSelected() {
    const res = this.reading();
    if (!res || res.error) return false;
    this.commit(res.combo);
    return true;
  }

  pass() { this.commit(null); }

  commit(move) {
    const { game } = this.store.get();
    if (!game || game.phase !== PHASE.PLAYING || game.current !== this.human) return;

    const generation = this.engine.generation;
    const snap = snapshot(game, this.human);
    this.store.set({ coach: { status: 'reviewing' } });

    // The review rides the coach channel, so it never delays the next bot move.
    this.engine.request('coach', 'review', { snap, seat: this.human, move, opts: this.strength() })
      .then((review) => {
        if (!this.#current(generation, game) || !review) return;
        this.#recordReview(review);
      })
      .catch((err) => {
        if (EngineClient.isStale(err)) return;
        this.onError?.(err);
        this.store.set({ coach: { status: 'error' } });
      });

    try {
      if (move) game.play(this.human, move);
      else game.pass(this.human);
    } catch (err) {
      this.onError?.(err);
      return;
    }
    this.store.set({ selected: new Set(), highlight: null, ...this.#prunedGroups() });
    this.store.touch();
    this.advance();
  }

  /** Drop cards that have left the hand; forget groups that are used up. */
  #prunedGroups() {
    const { game, groups } = this.store.get();
    const held = new Set(game.hands[this.human].map((c) => c.id));
    const next = groups
      .map((g) => ({ ...g, cardIds: g.cardIds.filter((id) => held.has(id)) }))
      .filter((g) => g.cardIds.length > 0);
    const same = next.length === groups.length
      && next.every((g, i) => g.cardIds.length === groups[i].cardIds.length);
    return same ? {} : { groups: next };
  }

  // -- arranging your hand --------------------------------------------------

  /** Pin the selected cards together so they stay as one unit in the hand. */
  createGroup() {
    const { game, selected, groups } = this.store.get();
    if (selected.size < 2) return;
    const cards = game.hands[this.human].filter((c) => selected.has(c.id));
    const ids = new Set(cards.map((c) => c.id));
    // A card belongs to at most one group: take it out of any it was already in.
    const rest = groups
      .map((g) => ({ ...g, cardIds: g.cardIds.filter((id) => !ids.has(id)) }))
      .filter((g) => g.cardIds.length > 0);
    const reading = identify(cards, game.level);
    const label = reading ? describeCombo(reading, game.level) : `${cards.length} cards`;
    this.store.set({
      groups: [...rest, { id: `g${++this.groupSeq}`, cardIds: cards.map((c) => c.id), label }],
    });
  }

  dissolveGroup(id) {
    const { groups } = this.store.get();
    this.store.set({ groups: groups.filter((g) => g.id !== id) });
  }

  /** Select a straight flush from the hand, cycling if there is more than one. */
  findFlush() {
    const { game, flushIndex } = this.store.get();
    if (!game) return;
    const flushes = legalMoves(game.hands[this.human], game.level, null)
      .filter((m) => m.type === TYPE.STRAIGHT_FLUSH)
      .sort((a, b) => a.rank - b.rank);
    if (!flushes.length) {
      this.store.set({
        highlight: null,
        coach: { status: 'note', text: 'No straight flush in your hand right now. '
          + 'A straight flush is five consecutive cards of one suit — it outranks every '
          + 'four- and five-card bomb, so it is worth watching for as cards come in.' },
      });
      return;
    }
    const i = (flushIndex + 1) % flushes.length;
    const pick = flushes[i];
    this.store.set({
      selected: new Set(pick.cards.map((c) => c.id)),
      highlight: new Set(pick.cards.map((c) => c.id)),
      flushIndex: i,
      coach: { status: 'note', text: flushes.length === 1
        ? `Found ${describeCombo(pick, game.level)}, highlighted in your hand.`
        : `Found ${flushes.length} straight flushes. Showing ${i + 1} of ${flushes.length}: `
          + `${describeCombo(pick, game.level)}. Press again to cycle.` },
    });
  }

  #recordReview(review) {
    const { stats } = this.store.get();
    this.store.set({
      coach: { status: 'review', review },
      stats: {
        moves: stats.moves + 1,
        best: stats.best + (review.verdict === 'best' ? 1 : 0),
        loss: stats.loss + Math.max(0, review.cost),
      },
    });
  }

  async hint() {
    const { game, phase } = this.store.get();
    if (phase !== UI.AWAITING_HUMAN) return;
    const generation = this.engine.generation;
    this.store.set({ coach: { status: 'hinting' } });
    try {
      const reply = await this.engine.request('coach', 'hint', {
        snap: snapshot(game, this.human), seat: this.human, opts: this.strength(),
      });
      if (!this.#current(generation, game)) return;
      this.store.set({
        selected: new Set(reply.move ? reply.move.cards.map((c) => c.id) : []),
        coach: { status: 'hint', hint: reply },
      });
    } catch (err) {
      if (EngineClient.isStale(err)) return;
      this.onError?.(err);
      this.store.set({ coach: { status: 'error' } });
    }
  }

  // -- tribute --------------------------------------------------------------

  #handleReturn() {
    const { game } = this.store.get();
    const owed = game.tribute.pending;
    if (owed.includes(this.human)) return void this.store.set({ phase: UI.RETURNING, thinkingSeat: null });
    const seat = owed[0];
    game.returnCard(seat, game.autoReturnCard(seat));
    this.store.touch();
    this.advance();
  }

  returnCard(card) {
    const { game } = this.store.get();
    if (game.phase !== PHASE.RETURN) return;
    game.returnCard(this.human, card);
    this.store.touch();
    this.advance();
  }
}
