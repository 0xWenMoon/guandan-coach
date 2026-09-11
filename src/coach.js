// Move review. Everything said here is grounded in something the engine
// actually computed: the level swing from the search, plus concrete structural
// facts about the hand.
import { handLabel, isWild, playValue, RANK_LABEL } from './cards.js';
import { describeCombo, isBomb, TYPE, TYPE_CN } from './combos.js';
import { decompose, brokenStructures } from './eval.js';
import { analyze } from './bot.js';
import { teamOf, partnerOf } from './game.js';
import { removeCards } from './moves.js';

export const VERDICTS = {
  best: { label: 'Best move', tone: 'best' },
  good: { label: 'Good', tone: 'good' },
  fine: { label: 'Fine', tone: 'good' },
  inaccuracy: { label: 'Inaccuracy', tone: 'warn' },
  mistake: { label: 'Mistake', tone: 'bad' },
  blunder: { label: 'Blunder', tone: 'bad' },
};

function verdictFor(cost, isTop) {
  if (isTop || cost <= 0.05) return 'best';
  if (cost < 0.25) return 'good';
  if (cost < 0.6) return 'fine';
  if (cost < 1.1) return 'inaccuracy';
  if (cost < 2.0) return 'mistake';
  return 'blunder';
}

const nameOf = (game, seat) => game.names[seat];

/**
 * Review a move BEFORE it is applied to the game.
 * Returns a verdict, the cost in levels, and the reasoning behind it.
 */
export function review(game, seat, move, opts = {}) {
  const analysis = opts.analysis ?? analyze(game, seat, { ...opts, include: move ? [move] : [] });
  const { ranked } = analysis;
  if (!ranked.length) return null;

  const mine = ranked.find((r) => sameMove(r.move, move)) ?? null;
  const best = ranked[0];
  const cost = mine ? best.value - mine.value : 0;
  const isTop = mine ? sameMove(best.move, move) : false;
  const verdict = mine ? verdictFor(cost, isTop) : 'fine';

  const reasons = explain(game, seat, move, best.move, { cost, isTop, ranked });
  // A move within noise of the top is "best" — don't also offer an alternative,
  // which would contradict the verdict.
  const equivalent = !isTop && cost <= 0.05;
  const alternative = (isTop || equivalent) ? null : best.move;

  return {
    verdict,
    cost,
    value: mine?.value ?? null,
    bestValue: best.value,
    played: move,
    best: best.move,
    alternative,
    headline: headlineFor(game, seat, move, best.move, verdict, cost, equivalent),
    reasons,
    ranked: ranked.slice(0, 5).map((r) => ({
      label: r.move ? describeCombo(r.move, game.level) : 'pass',
      cards: r.move ? handLabel(r.move.cards) : '',
      value: r.value,
    })),
    samples: analysis.samples,
    elapsedMs: analysis.elapsedMs,
  };
}

function headlineFor(game, seat, move, best, verdict, cost, equivalent) {
  const what = move ? describeCombo(move, game.level) : 'passing';
  if (equivalent) {
    return `${cap(what)} is as good as anything else here — the engine cannot separate it from ${best ? describeCombo(best, game.level) : 'passing'}.`;
  }
  if (verdict === 'best') return `${cap(what)} is the strongest option here.`;
  const alt = best ? describeCombo(best, game.level) : 'passing';
  const swing = cost < 0.95 ? `${Math.round(cost * 100)}% of a level` :
    `${cost.toFixed(1)} levels`;
  return `${cap(what)} costs about ${swing} against ${alt}.`;
}

/** Concrete, checkable reasons — not vibes. */
function explain(game, seat, move, best, ctx) {
  const level = game.level;
  const hand = game.hands[seat];
  const target = game.trick.target;
  const winner = game.trick.winner;
  const out = [];

  // --- who holds the trick right now
  if (target && winner != null && teamOf(winner) === teamOf(seat) && winner !== seat && move) {
    out.push({
      tag: 'partner',
      text: `${nameOf(game, winner)} is your partner and already holds this trick. Beating your own side spends a card for nothing and hands the lead back to the opponents.`,
    });
  }

  // --- going out
  if (move && move.cards.length === hand.length) {
    out.push({ tag: 'out', text: 'This empties your hand, which locks in your finishing position.' });
  } else {
    const goOut = ctx.ranked.find((r) => r.move && r.move.cards.length === hand.length);
    if (goOut && !sameMove(goOut.move, move)) {
      out.push({
        tag: 'out',
        text: `You could have gone out this turn with ${handLabel(goOut.move.cards)}.`,
      });
    }
  }

  // --- bombs
  if (move && isBomb(move) && best && !isBomb(best)) {
    out.push({
      tag: 'bomb',
      text: `Your ${describeCombo(move, level)} wins this trick, but ${describeCombo(best, level)} wins it too. A bomb is the card that saves you later, when an opponent is one play from going out.`,
    });
  }
  if (best && isBomb(best) && move && !isBomb(move)) {
    out.push({
      tag: 'bomb',
      text: `This is the moment to spend the bomb: ${describeCombo(best, level)} takes the lead back, and holding it any longer risks never getting to use it.`,
    });
  }

  // --- wildcards
  const wildsUsed = move ? move.wilds ?? move.cards.filter((c) => isWild(c, level)).length : 0;
  const bestWilds = best ? best.wilds ?? 0 : 0;
  if (wildsUsed > bestWilds) {
    out.push({
      tag: 'wild',
      text: `You spent ${wildsUsed === 1 ? 'the ♥' + RANK_LABEL[level] + ' wildcard' : 'both ♥' + RANK_LABEL[level] + ' wildcards'} here. The wildcard is the most flexible card in the deck — it can finish a bomb or fill a straight later, so it should not be used where an ordinary card does the same job.`,
    });
  }

  // --- rank efficiency: same shape, cheaper card
  if (move && best && move.type === best.type && move.cards.length === best.cards.length
      && move.rank > best.rank) {
    out.push({
      tag: 'overkill',
      text: target
        ? `${cap(describeCombo(best, level))} already beats what is on the table. Winning a trick by more than you had to is a card wasted.`
        : `${cap(describeCombo(best, level))} sets the same question for the table using cheaper cards. Leading the higher one throws away a winner you will want when the hands get short.`,
    });
  }

  // --- structural damage
  if (move) {
    const broken = brokenStructures(hand, move.cards, level);
    for (const p of broken.slice(0, 2)) {
      out.push({
        tag: 'break',
        text: `This pulls cards out of your ${TYPE_CN[p.type] ?? p.type} ${handLabel(p.cards)}, which you were otherwise going to play in one turn.`,
      });
    }
  }

  // --- turns left in hand
  if (move && best && !sameMove(move, best)) {
    const after = decompose(removeCards(hand, move.cards), level).count;
    const afterBest = decompose(removeCards(hand, best?.cards ?? []), level).count;
    if (after > afterBest) {
      out.push({
        tag: 'tempo',
        text: `After this you still need ${after} turns to empty your hand; ${best ? describeCombo(best, level) : 'the alternative'} leaves you needing ${afterBest}.`,
      });
    }
  }

  // --- spending a controlling card for no reason
  if (move && best && ctx.cost > 0.2) {
    const mineTop = topCardValue(move, level);
    const bestTop = topCardValue(best, level);
    if (mineTop > bestTop && mineTop >= 14) {
      const cardName = describeCard(move, level);
      out.push({
        tag: 'control',
        text: target
          ? `${cardName} is one of the few cards that beats anything. Winning this trick with it is real value thrown away — ${describeCombo(best, level)} takes the same trick and keeps the big card for when it decides the deal.`
          : `Leading ${cardName} gives up your best card for nothing: on a free lead nobody is forcing you, so the others simply pass and you have spent a winner to win a trick you already controlled. ${cap(describeCombo(best, level))} asks the table the same question at a fraction of the price.`,
      });
    }
  }

  // --- what a free lead is for
  if (!target && move && best && !sameMove(move, best) && !out.some((r) => r.tag === 'control')) {
    out.push({
      tag: 'lead',
      text: `You have the free lead, so you choose the shape everyone must answer. ${cap(describeCombo(best, level))} makes them respond while costing you little; keep the cards that win tricks for the turns where you have to win one.`,
    });
  }

  // --- passing
  if (!move) {
    out.push({
      tag: 'pass',
      text: ctx.isTop
        ? 'Passing is right here: nothing you hold is worth spending to win this trick, and your partner still gets a turn.'
        : 'Passing gives the trick away. The lead is worth real value in Guandan — whoever wins it chooses what everyone else has to answer.',
    });
  }

  // --- opponent pressure
  const danger = [0, 1, 2, 3].filter(
    (s) => teamOf(s) !== teamOf(seat) && game.isActive(s) && game.hands[s].length <= 3);
  if (danger.length) {
    out.push({
      tag: 'danger',
      text: `${danger.map((s) => `${nameOf(game, s)} has ${game.hands[s].length} card${game.hands[s].length === 1 ? '' : 's'}`).join(' and ')} left. Letting them take the lead now probably ends the deal.`,
    });
  }

  if (!out.length) {
    out.push({
      tag: 'even',
      text: ctx.isTop
        ? 'Nothing else in the hand does more here — it keeps your strong cards back without giving up the lead.'
        : ctx.cost < 0.3
          ? 'The difference is small; both lines keep the hand in roughly the same shape.'
          : `Across ${ctx.ranked[0].samples} simulated deals from this position, ${best ? describeCombo(best, level) : 'passing'} finished materially better, mostly through how the rest of the hand plays out rather than anything about this trick alone.`,
    });
  }
  return out;
}

/** Highest play-value among the cards a move spends. */
function topCardValue(move, level) {
  if (!move) return -1;
  return Math.max(...move.cards.map((c) => (isWild(c, level) ? 14.5 : playValue(c.rank, level))));
}

/** Name the single most valuable card a move spends. */
function describeCard(move, level) {
  const top = move.cards.reduce((hi, c) =>
    (playValue(c.rank, level) > playValue(hi.rank, level) ? c : hi));
  if (top.rank === 16) return 'the big joker';
  if (top.rank === 15) return 'a small joker';
  if (isWild(top, level)) return `the ♥${RANK_LABEL[level]} wildcard`;
  if (top.rank === level) return `a ${RANK_LABEL[level]} (the level card)`;
  return `the ${RANK_LABEL[top.rank]}`;
}

export function sameMove(a, b) {
  if (!a && !b) return true;
  if (!a || !b) return false;
  if (a.type !== b.type || a.cards.length !== b.cards.length) return false;
  const s = new Set(a.cards.map((c) => c.id));
  return b.cards.every((c) => s.has(c.id));
}

const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** A short note on why the bot chose what it chose, for the opponents' moves. */
export function narrate(game, seat, move) {
  const level = game.level;
  if (!move) return `${nameOf(game, seat)} passes.`;
  return `${nameOf(game, seat)} plays ${describeCombo(move, level)}.`;
}
