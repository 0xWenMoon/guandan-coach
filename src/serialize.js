// Snapshot a game for the worker. Hands other than `forSeat` are redacted to
// bare placeholders: the bot receives only their card COUNT, never their cards,
// so it cannot peek even by accident.
import { Game } from './game.js';

const NULL_LOG = { push() {} };

export function snapshot(game, forSeat) {
  return {
    names: game.names,
    levels: game.levels.slice(),
    aAttempts: game.aAttempts.slice(),
    activeTeam: game.activeTeam,
    dealNumber: game.dealNumber,
    lastFinishOrder: game.lastFinishOrder ? game.lastFinishOrder.slice() : null,
    phase: game.phase,
    current: game.current,
    finished: game.finished.slice(),
    forSeat,
    hands: game.hands.map((h, i) =>
      (i === forSeat ? h.map((c) => ({ id: c.id, rank: c.rank, suit: c.suit })) : h.map(() => null))),
    playedCards: [...game.playedCards],
    known: game.known.map((a) => a.slice()),
    trick: game.trick ? {
      target: game.trick.target,
      winner: game.trick.winner,
      leader: game.trick.leader,
      passed: [...game.trick.passed],
    } : null,
  };
}

export function restore(snap) {
  const g = Object.create(Game.prototype);
  g.rng = Math.random;
  g.names = snap.names;
  g.levels = snap.levels;
  g.aAttempts = snap.aAttempts;
  g.activeTeam = snap.activeTeam;
  g.dealNumber = snap.dealNumber;
  g.lastFinishOrder = snap.lastFinishOrder;
  g.phase = snap.phase;
  g.current = snap.current;
  g.finished = snap.finished;
  g.hands = snap.hands;
  g.playedCards = new Set(snap.playedCards);
  g.known = snap.known;
  g.log = NULL_LOG;
  g.winner = null;
  g.tribute = null;
  g.trick = snap.trick ? {
    target: snap.trick.target,
    winner: snap.trick.winner,
    leader: snap.trick.leader,
    passed: new Set(snap.trick.passed),
    plays: [],
  } : null;
  return g;
}
