// Determinized Monte Carlo search.
//
// Guandan is an imperfect-information game far too large to solve, so the bot
// does what strong card-game engines do: sample the hidden hands many times,
// play each sample out with a fast heuristic policy, and pick the move with the
// best average outcome. Every candidate move is scored on the *same* sampled
// deals (common random numbers), which cuts the variance enormously.
import { makeDeck, shuffle } from './cards.js';
import { Game, teamOf, PHASE } from './game.js';
import { legalMoves } from './moves.js';
import { isBomb, bombTier, TYPE } from './combos.js';

const NULL_LOG = { push() {} };

export function cloneForSim(game, hands) {
  const s = Object.create(Game.prototype);
  s.rng = game.rng;
  s.names = game.names;
  s.levels = game.levels.slice();
  s.aAttempts = game.aAttempts.slice();
  s.activeTeam = game.activeTeam;
  s.dealNumber = game.dealNumber;
  s.lastFinishOrder = game.lastFinishOrder;
  s.winner = game.winner;
  s.phase = game.phase;
  s.log = NULL_LOG;
  s.playedCards = new Set(game.playedCards);
  s.known = game.known;
  s.hands = (hands ?? game.hands).map((h) => h.slice());
  s.finished = game.finished.slice();
  s.tribute = game.tribute;
  s.current = game.current;
  s.trick = {
    target: game.trick.target,
    winner: game.trick.winner,
    leader: game.trick.leader,
    passed: new Set(game.trick.passed),
    plays: game.trick.plays.slice(),
  };
  return s;
}

/** Deal the cards this seat cannot see into the other three hands at random. */
export function sampleHands(game, seat, rng = Math.random) {
  const deck = makeDeck();
  const byId = new Map(deck.map((c) => [c.id, c]));
  const used = new Set(game.hands[seat].map((c) => c.id));
  for (const id of game.playedCards) used.add(id);

  const hands = [[], [], [], []];
  hands[seat] = game.hands[seat].slice();

  // Cards handed over as tribute are public knowledge.
  for (const s of [0, 1, 2, 3]) {
    if (s === seat) continue;
    for (const id of game.known[s] ?? []) {
      if (used.has(id) || hands[s].length >= game.hands[s].length) continue;
      hands[s].push(byId.get(id));
      used.add(id);
    }
  }

  const pool = shuffle(deck.filter((c) => !used.has(c.id)), rng);
  let k = 0;
  for (const s of [0, 1, 2, 3]) {
    if (s === seat) continue;
    while (hands[s].length < game.hands[s].length && k < pool.length) hands[s].push(pool[k++]);
  }
  return hands;
}

// --- rollout policy --------------------------------------------------------

// Lead low and long, and treat a wildcard as expensive: spending ♥level to
// complete an ordinary pair throws away the most flexible card in the deck.
const leadKey = (m) => m.rank * 100 - m.cards.length + (m.wilds ?? 0) * 400;
const bombKey = (m) => bombTier(m) * 1000 + m.rank;

function minOpponentCards(sim, seat) {
  let min = Infinity;
  for (const s of [0, 1, 2, 3]) {
    if (teamOf(s) === teamOf(seat) || !sim.isActive(s)) continue;
    min = Math.min(min, sim.hands[s].length);
  }
  return min;
}

/**
 * Fast, plausible play used inside rollouts. Returns null to pass.
 *
 * `bombEarly` implements the Guandan maxim 晚炸不如早炸 — bombing late is worse
 * than bombing early. A player who leads a big shape usually holds more of
 * them, so breaking one up straight away is better than sitting on a bomb you
 * may never get to spend. Measured against the hoarding policy in bench.js.
 */
export function policyMove(sim, seat, rng, opts = {}) {
  const { bombEarly = true } = opts;
  const target = sim.trick.target;
  const hand = sim.hands[seat];
  const moves = legalMoves(hand, sim.level, target);
  if (!moves.length) return null;

  // Going out is almost always right.
  const out = moves.find((m) => m.cards.length === hand.length);
  if (out) return out;

  const nonBomb = moves.filter((m) => !isBomb(m));

  if (!target) {
    const pool = nonBomb.length ? nonBomb : moves;
    return pool.reduce((b, m) => (leadKey(m) < leadKey(b) ? m : b));
  }

  // Never overtake your own partner.
  if (sim.trick.winner != null && teamOf(sim.trick.winner) === teamOf(seat)) return null;

  const urgency = minOpponentCards(sim, seat);
  if (nonBomb.length) {
    const cheap = nonBomb.reduce((b, m) =>
      (m.rank !== b.rank ? (m.rank < b.rank ? m : b) : (m.wilds < b.wilds ? m : b)));
    if (urgency > 5) {
      // Don't spend controlling cards to win a cheap trick early.
      if (cheap.rank >= 15 && target.rank <= 10 && rng() < 0.75) return null;
      if (cheap.wilds > 0 && rng() < 0.6) return null;
    }
    return cheap;
  }

  // Bombs only.
  const cheapestBomb = () => moves.reduce((b, m) => (bombKey(m) < bombKey(b) ? m : b));
  if (urgency <= 3) return cheapestBomb();
  // 晚炸不如早炸: a five-card-plus shape from an opponent is worth breaking now.
  if (bombEarly && target.cards.length >= 5 && rng() < 0.6) return cheapestBomb();
  return null;
}

export function rollout(sim, rng, opts) {
  let guard = 0;
  while (sim.phase === PHASE.PLAYING) {
    if (guard++ > 4000) break;
    const seat = sim.current;
    const m = policyMove(sim, seat, rng, opts);
    if (m) sim.play(seat, m, { validate: false });
    else sim.pass(seat);
  }
  return sim.result;
}

/** Score a finished deal from one team's point of view: +3 .. -3 levels. */
export function dealValue(result, team) {
  if (!result) return 0;
  return result.winTeam === team ? result.gain : -result.gain;
}

// --- candidate selection ---------------------------------------------------

/**
 * Search every legal move is wasteful — most differ only in a card that does not
 * matter. Keep the cheapest and dearest of each shape, plus anything that goes
 * out, plus the smallest bomb.
 */
export function shortlist(moves, hand, limit = 12) {
  const picked = new Map();
  const add = (m) => { if (m) picked.set(m.cards.map((c) => c.id).sort().join(), m); };

  for (const m of moves) if (m.cards.length === hand.length) add(m);

  const byShape = new Map();
  for (const m of moves) {
    if (isBomb(m)) continue;
    const k = `${m.type}|${m.cards.length}`;
    if (!byShape.has(k)) byShape.set(k, []);
    byShape.get(k).push(m);
  }
  for (const list of byShape.values()) {
    list.sort((a, b) => a.rank - b.rank || a.wilds - b.wilds);
    add(list[0]);
    if (list.length > 1) add(list[1]);
    if (list.length > 2) add(list[list.length - 1]);
  }

  const bombs = moves.filter(isBomb).sort((a, b) => bombKey(a) - bombKey(b));
  if (bombs.length) add(bombs[0]);
  if (bombs.length > 1) add(bombs[bombs.length - 1]);

  const out = [...picked.values()];
  return out.length <= limit ? out : out.slice(0, limit);
}

// --- search ----------------------------------------------------------------

/**
 * Rank the moves available to `seat`. Returns candidates sorted best-first,
 * each with the average level swing (+3 .. -3) it produced across the sampled
 * deals. `null` in the `move` field means passing.
 */
export function analyze(game, seat, opts = {}) {
  const {
    samples = 30,
    rng = Math.random,
    limit = 12,
    timeBudgetMs = 2500,
    include = [],
  } = opts;

  const target = game.trick.target;
  const moves = legalMoves(game.hands[seat], game.level, target);
  const candidates = shortlist(moves, game.hands[seat], limit);

  const have = new Set(candidates.map((m) => key(m)));
  for (const m of include) {
    if (m && !have.has(key(m))) { candidates.push(m); have.add(key(m)); }
  }
  if (target) candidates.push(null); // passing is always an option once a trick is live

  const team = teamOf(seat);
  const stats = candidates.map((move) => ({ move, total: 0, n: 0 }));
  const t0 = Date.now();
  let used = 0;

  for (let s = 0; s < samples; s++) {
    const hands = sampleHands(game, seat, rng);
    for (const st of stats) {
      const sim = cloneForSim(game, hands);
      try {
        if (st.move) sim.play(seat, st.move, { validate: false });
        else sim.pass(seat);
        const result = sim.phase === PHASE.PLAYING ? rollout(sim, rng) : sim.result;
        st.total += dealValue(result, team);
        st.n++;
      } catch {
        // A sampled deal that the candidate cannot legally reach is simply skipped.
      }
    }
    used = s + 1;
    if (Date.now() - t0 > timeBudgetMs) break;
  }

  const ranked = stats
    .filter((s) => s.n > 0)
    .map((s) => ({ move: s.move, value: s.total / s.n, samples: s.n }))
    .sort((a, b) => b.value - a.value);

  return { ranked, best: ranked[0], samples: used, elapsedMs: Date.now() - t0, seat, level: game.level };
}

function key(m) { return m ? m.type + '|' + m.cards.map((c) => c.id).sort().join() : 'pass'; }

/** Convenience wrapper: just give me the move to play (null = pass). */
export function chooseMove(game, seat, opts = {}) {
  const { ranked } = analyze(game, seat, opts);
  return ranked.length ? ranked[0].move : null;
}
