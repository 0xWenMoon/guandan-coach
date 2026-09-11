// Move review.
//
// The verdict comes from the search (the level swing between your move and the
// best one). Every reason attached to it is a checked fact — a structural
// property of your hand, or something countable from the cards already played —
// and is tagged with the Guandan principle it comes from, so the advice is
// transferable rather than a one-off comment.
import { handLabel, isWild, playValue, RANK_LABEL } from './cards.js';
import { describeCombo, isBomb, TYPE, TYPE_CN } from './combos.js';
import { decompose, brokenStructures } from './eval.js';
import { analyze } from './bot.js';
import { teamOf, partnerOf } from './game.js';
import { removeCards } from './moves.js';
import {
  outstanding, highestOutstanding, bombThreats, unbeatableExceptBombs,
  handPlan, race, label,
} from './knowledge.js';

export const PRINCIPLES = {
  leadSmall:    { cn: '先出小牌', en: 'lead small, keep the big cards back' },
  bombEarly:    { cn: '晚炸不如早炸', en: 'bombing late is worse than bombing early' },
  probePair:    { cn: '情况不明，对子先行', en: 'when the table is unclear, probe with a pair' },
  countGaps:    { cn: '记断张', en: 'count the gaps — a rank you hold none of is bomb material' },
  helpPartner:  { cn: '帮对家走牌', en: 'if you cannot go out, get your partner out' },
  noOvertake:   { cn: '不盖对家', en: 'never take a trick off your own partner' },
  keepLead:     { cn: '留牌权', en: 'the lead is worth more than the trick' },
  keepShapes:   { cn: '配牌', en: 'keep your combinations intact' },
  countRounds:  { cn: '算轮次', en: 'count how many turns your hand still needs' },
};

const VERDICT_ORDER = ['best', 'good', 'fine', 'inaccuracy', 'mistake', 'blunder'];

function verdictFor(cost, isTop) {
  if (isTop || cost <= 0.05) return 'best';
  if (cost < 0.25) return 'good';
  if (cost < 0.6) return 'fine';
  if (cost < 1.1) return 'inaccuracy';
  if (cost < 2.0) return 'mistake';
  return 'blunder';
}

const nameOf = (game, seat) => game.names[seat];
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

export function review(game, seat, move, opts = {}) {
  const analysis = opts.analysis ?? analyze(game, seat, { ...opts, include: move ? [move] : [] });
  const { ranked } = analysis;
  if (!ranked.length) return null;

  const mine = ranked.find((r) => sameMove(r.move, move)) ?? null;
  const best = ranked[0];
  const cost = mine ? best.value - mine.value : 0;
  const isTop = mine ? sameMove(best.move, move) : false;
  const equivalent = !isTop && cost <= 0.05;
  const verdict = mine ? verdictFor(cost, isTop) : 'fine';

  // How clearly the search separated the top two lines.
  const margin = ranked.length > 1 ? ranked[0].value - ranked[1].value : Infinity;
  const confident = margin >= 0.2 || ranked.length === 1;

  const facts = tableFacts(game, seat);
  const reasons = explain(game, seat, move, best.move, { cost, isTop, ranked, facts });

  return {
    verdict,
    cost,
    confident,
    margin: margin === Infinity ? null : margin,
    value: mine?.value ?? null,
    bestValue: best.value,
    played: move,
    best: best.move,
    alternative: (isTop || equivalent) ? null : best.move,
    headline: headlineFor(game, seat, move, best.move, verdict, cost, equivalent),
    reasons,
    table: facts.lines,
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
    return `${cap(what)} is as good as anything else here — the engine cannot separate it from `
      + `${best ? describeCombo(best, game.level) : 'passing'}.`;
  }
  if (verdict === 'best') return `${cap(what)} is the strongest option here.`;
  const alt = best ? describeCombo(best, game.level) : 'passing';
  const swing = cost < 0.95 ? `${Math.round(cost * 100)}% of a level` : `${cost.toFixed(1)} levels`;
  return `${cap(what)} costs about ${swing} against ${alt}.`;
}

// ---------------------------------------------------------------------------
// What the table says right now — shown whatever you played.
// ---------------------------------------------------------------------------

function tableFacts(game, seat) {
  const level = game.level;
  const left = outstanding(game, seat);
  const plan = handPlan(game.hands[seat], level);
  const positions = race(game, seat);
  const top = highestOutstanding(left, level);
  const threats = bombThreats(game, seat, left);
  const lines = [];

  lines.push({
    label: 'Your hand',
    text: `${plan.cards} cards, ${plan.turns} turns to empty it`
      + `${plan.bombs ? `, ${plan.bombs} bomb${plan.bombs > 1 ? 's' : ''}` : ''}`
      + `, ${plan.control} card${plan.control === 1 ? '' : 's'} that take a trick outright.`,
  });

  if (top) {
    lines.push({
      label: 'Still out there',
      text: `The best card nobody has shown is the ${label(top.rank)}`
        + `${top.count > 1 ? ` — ${top.count} of them still unseen` : ''}.`,
    });
  }

  const blind = threats.find((t) => t.held === 0 && t.outside === 8);
  if (blind) {
    lines.push({
      label: 'Bomb risk',
      text: `You hold no ${label(blind.rank)}s and none have been played — all eight are `
        + `unseen, so a ${label(blind.rank)} bomb is live.`,
    });
  }

  if (positions.opponents.length) {
    lines.push({
      label: 'Opponents',
      text: positions.opponents
        .map((o) => `${nameOf(game, o.seat)} ${o.cards}`).join(', ')
        + ' cards left'
        + (positions.partnerOut ? ' · your partner is already out'
          : ` · your partner ${positions.partner}`),
    });
  }
  return { lines, left, plan, positions, top, threats };
}

// ---------------------------------------------------------------------------
// Why this move, specifically.
// ---------------------------------------------------------------------------

function explain(game, seat, move, best, ctx) {
  const level = game.level;
  const hand = game.hands[seat];
  const target = game.trick.target;
  const winner = game.trick.winner;
  const { left, plan, positions } = ctx.facts;
  const out = [];
  const add = (tag, principle, text) => out.push({ tag, principle: principle ?? null, text });

  // --- overtaking your own partner. Only worth saying when the engine's own
  // recommendation is to stay out; if it would also play over the partner, the
  // criticism does not apply and would contradict the advice below.
  if (target && winner != null && teamOf(winner) === teamOf(seat) && winner !== seat && move && !best) {
    add('partner', PRINCIPLES.noOvertake,
      `${nameOf(game, winner)} is your partner and already holds this trick. Beating your own `
      + 'side spends a card for nothing and hands the lead straight back to the opponents.');
  }

  // --- going out
  if (move && move.cards.length === hand.length) {
    add('out', null, 'This empties your hand, which locks in your finishing position.');
  } else {
    const goOut = ctx.ranked.find((r) => r.move && r.move.cards.length === hand.length);
    if (goOut && !sameMove(goOut.move, move)) {
      add('out', null, `You could have gone out this turn with ${handLabel(goOut.move.cards)}.`);
    }
  }

  // --- is this play actually unanswerable?
  if (move && unbeatableExceptBombs(move, left, level)) {
    add('boss', PRINCIPLES.countGaps,
      `Nothing outside beats this any more — every higher ${move.type === 'pair' ? 'pair' : 'card'} `
      + 'is accounted for, so only a bomb takes the trick off you.');
  }

  // --- bombs, both directions
  if (move && isBomb(move) && best && !isBomb(best)) {
    add('bomb', PRINCIPLES.keepLead,
      `Your ${describeCombo(move, level)} wins this trick, but ${describeCombo(best, level)} wins `
      + 'it too. A bomb is what saves you later, when an opponent is one play from going out.');
  }
  if (best && isBomb(best) && move && !isBomb(move)) {
    const multi = target && target.cards.length >= 5;
    add('bomb', multi ? PRINCIPLES.bombEarly : PRINCIPLES.keepLead,
      multi
        ? `This is the moment to spend it. ${cap(describeCombo(best, level))} breaks up a big shape `
          + 'early, while they still hold the rest of it — a bomb you never get to play is worth nothing.'
        : `${cap(describeCombo(best, level))} takes the lead back, and holding the bomb any longer `
          + 'risks never getting to use it.');
  }

  // --- wildcards
  const wildsUsed = move ? move.wilds ?? 0 : 0;
  if (wildsUsed > (best?.wilds ?? 0)) {
    add('wild', PRINCIPLES.keepShapes,
      `You spent ${wildsUsed === 1 ? `the ♥${RANK_LABEL[level]} wildcard` : `both ♥${RANK_LABEL[level]} wildcards`} `
      + 'here. The wildcard is the most flexible card in the deck — it can finish a bomb or fill a '
      + 'straight later, so it should not go where an ordinary card does the same job.');
  }

  // --- same shape, cheaper card
  if (move && best && move.type === best.type && move.cards.length === best.cards.length
      && move.rank > best.rank) {
    add('overkill', PRINCIPLES.leadSmall, target
      ? `${cap(describeCombo(best, level))} already beats what is on the table. Winning by more `
        + 'than you had to is a card wasted.'
      : `${cap(describeCombo(best, level))} asks the table the same question with cheaper cards.`);
  }

  // --- spending a controlling card
  if (move && best && ctx.cost > 0.2) {
    const mineTop = topCardValue(move, level);
    if (mineTop > topCardValue(best, level) && mineTop >= 14) {
      add('control', PRINCIPLES.keepLead, target
        ? `${cap(describeCard(move, level))} is one of the few cards that beats anything. Winning `
          + `this trick with it is real value thrown away — ${describeCombo(best, level)} takes the `
          + 'same trick and keeps the big card for when it decides the deal.'
        : `Leading ${describeCard(move, level)} gives up your best card for nothing: on a free lead `
          + 'nobody is forcing you, so the others simply pass and you have spent a winner to take a '
          + 'trick you already controlled.');
    }
  }

  // --- structural damage
  if (move) {
    for (const p of brokenStructures(hand, move.cards, level).slice(0, 2)) {
      add('break', PRINCIPLES.keepShapes,
        `This pulls cards out of your ${TYPE_CN[p.type] ?? p.type} ${handLabel(p.cards)}, which you `
        + 'were otherwise going to play in a single turn.');
    }
  }

  // --- turns left
  if (move && best && !sameMove(move, best)) {
    const after = decompose(removeCards(hand, move.cards), level).count;
    const afterBest = decompose(removeCards(hand, best?.cards ?? []), level).count;
    if (after > afterBest) {
      add('tempo', PRINCIPLES.countRounds,
        `After this you still need ${after} turns to empty your hand; `
        + `${describeCombo(best, level)} leaves you needing ${afterBest}.`);
    }
  }

  // --- free-lead guidance
  if (!target && move && best && !sameMove(move, best) && !out.some((r) => r.tag === 'control')) {
    const bestIsPair = best.type === TYPE.PAIR;
    add('lead', bestIsPair ? PRINCIPLES.probePair : PRINCIPLES.leadSmall,
      bestIsPair
        ? `${cap(describeCombo(best, level))} is a probe: a pair makes everyone answer and tells you `
          + 'who is holding what, without spending anything you need later.'
        : `You have the free lead, so you choose the shape everyone must answer. `
          + `${cap(describeCombo(best, level))} makes them respond while costing you little.`);
  }

  // --- passing
  if (!move) {
    add('pass', ctx.isTop ? PRINCIPLES.keepLead : null, ctx.isTop
      ? 'Passing is right here: nothing you hold is worth spending to win this trick, and your '
        + 'partner still gets a turn.'
      : 'Passing gives the trick away. Whoever wins the lead chooses what everyone else has to answer.');
  }

  // --- the partnership
  if (positions.supportPartner) {
    add('support', PRINCIPLES.helpPartner,
      `Your partner is down to ${positions.partner} cards against your ${positions.me}. Their race is `
      + 'the one that matters now — if they finish first your team scores even if you come last, so '
      + 'give them the lead rather than competing for it.');
  }

  // --- pressure
  const danger = positions.opponents.filter((o) => o.cards <= 3);
  if (danger.length) {
    add('danger', PRINCIPLES.bombEarly,
      danger.map((o) => `${nameOf(game, o.seat)} has ${o.cards} card${o.cards === 1 ? '' : 's'}`).join(' and ')
      + ' left. Letting them take the lead now probably ends the deal.');
  }

  if (!out.length) {
    add('even', null, ctx.isTop
      ? `Nothing else in the hand does more here — it keeps your strong cards back without giving up `
        + `the lead, and leaves you ${plan.turns} turns from finishing.`
      : ctx.cost < 0.3
        ? 'The difference is small; both lines keep the hand in roughly the same shape.'
        : `Across the simulated deals, ${best ? describeCombo(best, level) : 'passing'} finished `
          + 'materially better — through how the rest of the hand plays out rather than anything '
          + 'about this trick alone.');
  }
  return out;
}

function topCardValue(move, level) {
  if (!move) return -1;
  return Math.max(...move.cards.map((c) => (isWild(c, level) ? 14.5 : playValue(c.rank, level))));
}

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

export function narrate(game, seat, move) {
  if (!move) return `${nameOf(game, seat)} passes.`;
  return `${nameOf(game, seat)} plays ${describeCombo(move, game.level)}.`;
}

export { VERDICT_ORDER };
