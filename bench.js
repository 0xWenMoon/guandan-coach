// Strength benchmark: pit the bot's policies against each other over many deals.
import { Game, PHASE, teamOf } from './src/game.js';
import { policyMove, analyze, dealValue } from './src/bot.js';
import { legalMoves } from './src/moves.js';

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const randomAgent = (rng) => (g, seat) => {
  const moves = legalMoves(g.hands[seat], g.level, g.trick.target);
  if (!g.trick.target) return moves[Math.floor(rng() * moves.length)];
  if (!moves.length || rng() < 0.35) return null;
  return moves[Math.floor(rng() * moves.length)];
};
const greedyAgent = (rng) => (g, seat) => policyMove(g, seat, rng);
const hoardAgent = (rng) => (g, seat) => policyMove(g, seat, rng, { bombEarly: false });
const searchAgent = (rng, samples, limit) => (g, seat) =>
  (analyze(g, seat, { samples, limit, rng, timeBudgetMs: 3000 }).best?.move ?? null);

function playDeal(g, agents, rng) {
  while (g.phase === PHASE.RETURN) {
    const s = g.tribute.pending[0];
    g.returnCard(s, g.autoReturnCard(s));
  }
  let guard = 0;
  while (g.phase === PHASE.PLAYING) {
    if (guard++ > 4000) throw new Error('stuck');
    const seat = g.current;
    const m = agents[teamOf(seat)](g, seat);
    if (m) g.play(seat, m); else g.pass(seat);
  }
  return g.result;
}

export function match(agentA, agentB, deals, seed) {
  const rng = mulberry32(seed);
  let total = 0, wins = 0;
  for (let i = 0; i < deals; i++) {
    const g = new Game({ rng });
    g.startDeal();
    // Alternate which team sits in seats 0/2 so seating luck cancels out.
    const agents = i % 2 === 0 ? [agentA(rng), agentB(rng)] : [agentB(rng), agentA(rng)];
    const r = playDeal(g, agents, rng);
    const aTeam = i % 2 === 0 ? 0 : 1;
    total += dealValue(r, aTeam);
    if (r.winTeam === aTeam) wins++;
  }
  return { deals, avgLevelSwing: total / deals, winRate: wins / deals };
}

const which = process.argv[2] ?? 'greedy';
if (which === 'greedy') {
  const r = match(greedyAgent, randomAgent, 200, 99);
  console.log('greedy policy vs random:', JSON.stringify(r));
} else if (which === 'policy') {
  // Does 晚炸不如早炸 actually beat hoarding the bomb? Head to head.
  const n = Number(process.argv[3] ?? 400);
  const r = match(greedyAgent, hoardAgent, n, 4242);
  console.log(`bomb-early vs bomb-hoarding over ${n} deals:`, JSON.stringify(r));
} else {
  const n = Number(process.argv[3] ?? 20);
  const r = match((rng) => searchAgent(rng, 6, 8), greedyAgent, n, 1234);
  console.log(`MC search (6 samples) vs greedy over ${n} deals:`, JSON.stringify(r));
}
