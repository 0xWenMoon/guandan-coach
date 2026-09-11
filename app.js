// Bootstrap: build the views, wire the controls, let the store drive redraws.
import { createStore } from './ui/store.js';
import { EngineClient } from './ui/engine-client.js';
import { Controller, UI } from './ui/controller.js';
import { createHandView } from './ui/views/hand.js';
import { createTableView } from './ui/views/table.js';
import { createCoachView } from './ui/views/coach.js';
import { createLogView } from './ui/views/log.js';
import { createModalView } from './ui/views/modal.js';
import { createCardCache } from './ui/views/cards.js';
import { el, text, enable } from './ui/dom.js';
import { RANK_LABEL, SUIT_SYMBOL, isJoker } from './src/cards.js';
import { describeCombo } from './src/combos.js';
import { teamOf } from './src/game.js';

const HUMAN = 0;
const NAMES = ['You', 'West', 'North', 'East'];
const PLACES = ['头游 1st', '二游 2nd', '三游 3rd', '末游 4th'];
const STRENGTH = {
  fast:   { samples: 12, limit: 8,  timeBudgetMs: 1200 },
  normal: { samples: 30, limit: 12, timeBudgetMs: 3200 },
  strong: { samples: 80, limit: 14, timeBudgetMs: 9000 },
};

const $ = (id) => document.getElementById(id);
const cardText = (c) => (isJoker(c) ? (c.rank === 16 ? '大王' : '小王') : SUIT_SYMBOL[c.suit] + RANK_LABEL[c.rank]);

const store = createStore({
  game: null, phase: UI.BOOTING, selected: new Set(), thinkingSeat: null,
  coach: { status: 'idle' }, stats: { moves: 0, best: 0, loss: 0 }, version: 0,
});

const engine = new EngineClient('./src/worker.js');
const controller = new Controller({
  store, engine, human: HUMAN, names: NAMES,
  strength: () => STRENGTH[$('strength').value] ?? STRENGTH.normal,
  onError: (err) => console.error(err),
});

const handView = createHandView($('hand'), {
  onToggle: (id) => controller.toggleCard(id),
  onDissolveGroup: (id) => controller.dissolveGroup(id),
});
const tableView = createTableView({
  seatRoot: (seat) => $(`seat-${seat}`),
  playRoot: (seat) => $(`play-${seat}`),
  labelNode: $('trick-label'), turnNode: $('turn'),
  names: NAMES, human: HUMAN,
});
const coachView = createCoachView({ body: $('coachbody'), accuracy: $('accuracy') });
const logView = createLogView($('log'), { names: NAMES, human: HUMAN });
const modal = createModalView($('modal'), $('sheet'));
const modalCards = createCardCache();

let lastGame = null;
let modalKey = null;

store.subscribe(render);

function render(state) {
  const { game } = state;
  if (!game) return;
  if (game !== lastGame) { lastGame = game; logView.reset(); modalKey = null; }

  renderHeader(game);
  tableView({ game, thinkingSeat: state.thinkingSeat });
  handView({
    cards: game.hands[HUMAN], level: game.level,
    selected: state.selected, interactive: state.phase === UI.AWAITING_HUMAN,
    groups: state.groups ?? [], highlight: state.highlight ?? null,
  });
  renderControls(state);
  coachView({ coach: state.coach, stats: state.stats, level: game.level });
  logView.render(game);
  renderModal(state);
}

function renderHeader(game) {
  text($('lvl-us'), RANK_LABEL[game.levels[0]]);
  text($('lvl-them'), RANK_LABEL[game.levels[1]]);
  text($('deal'), game.dealNumber);
  text($('level-card'), RANK_LABEL[game.level]);
  text($('wild-note'), `♥${RANK_LABEL[game.level]} is wild`);
}

function renderControls(state) {
  const { game } = state;
  const yourTurn = state.phase === UI.AWAITING_HUMAN;
  const info = $('selinfo');

  enable($('pass'), yourTurn && !!game.trick?.target);
  enable($('hint'), yourTurn);
  enable($('flush'), !!game && game.hands[HUMAN].length >= 5);
  enable($('group'), state.selected.size >= 2);
  enable($('clear'), state.selected.size > 0 || (state.highlight?.size ?? 0) > 0);

  if (!yourTurn) {
    enable($('play'), false);
    text(info, '');
    info.className = 'selinfo';
    return;
  }
  if (!state.selected.size) {
    enable($('play'), false);
    text(info, game.trick.target
      ? 'Select cards that beat the current play, or pass.'
      : 'Select cards to lead.');
    info.className = 'selinfo';
    return;
  }
  const res = controller.reading();
  if (res.error) {
    enable($('play'), false);
    text(info, res.error);
    info.className = 'selinfo err';
  } else {
    enable($('play'), true);
    text(info, `Plays as ${describeCombo(res.combo, game.level)}`);
    info.className = 'selinfo ok';
  }
}

// -- modals -----------------------------------------------------------------

function modalKeyFor(state) {
  if (state.phase === UI.RETURNING) return `return:${state.game.dealNumber}`;
  if (state.phase === UI.DEAL_OVER) return `deal:${state.game.dealNumber}`;
  if (state.phase === UI.MATCH_OVER) return 'match';
  return null;
}

function renderModal(state) {
  const key = modalKeyFor(state);
  if (key === modalKey) return;
  modalKey = key;
  if (!key) return modal.close();
  if (key.startsWith('return')) return openReturn(state.game);
  if (key.startsWith('deal')) return openDealOver(state.game);
  return openMatchOver(state);
}

function openReturn(game) {
  const pair = game.tribute.pairs.find((p) => p.to === HUMAN);
  const eligible = game.hands[HUMAN].filter((c) => c.rank <= 10);
  const pool = eligible.length ? eligible : game.hands[HUMAN];
  modal.open((sheet) => {
    sheet.append(
      el('h2', {}, 'Return a card'),
      el('p', {}, `${NAMES[pair.from]} paid you tribute with ${cardText(pair.card)}. `
        + 'You must return a card of 10 or lower (还贡).'));
    const row = el('div', { class: 'cards' });
    for (const card of pool) {
      const node = modalCards.get(card, game.level, '');
      node.onclick = () => { modal.close(); controller.returnCard(card); };
      row.append(node);
    }
    sheet.append(row);
  });
}

function openDealOver(game) {
  const r = game.result;
  const won = teamOf(r.order[0]) === teamOf(HUMAN);
  modal.open((sheet) => {
    sheet.append(el('h2', {}, `Deal ${r.deal} complete`));
    const standings = el('div', { class: 'standings' });
    r.order.forEach((seat, i) => standings.append(el('div', {}, el('span', {}, `${PLACES[i]} — ${NAMES[seat]}`))));
    sheet.append(standings);
    sheet.append(el('p', {},
      `${won ? 'Your team' : 'The opponents'} took the deal: +${r.gain} level${r.gain > 1 ? 's' : ''}, `
      + `now playing at ${RANK_LABEL[game.levels[r.winTeam]]}.`
      + (r.resetTeam != null
        ? ` ${r.resetTeam === teamOf(HUMAN) ? 'Your team' : 'The opponents'} failed at A three times and drops back to 2.`
        : '')));
    sheet.append(el('div', { class: 'row' },
      el('button', { class: 'primary', onclick: () => { modal.close(); controller.nextDeal(); } }, 'Next deal')));
  });
}

function openMatchOver(state) {
  const { game, stats } = state;
  const won = game.winner === teamOf(HUMAN);
  modal.open((sheet) => {
    sheet.append(
      el('h2', {}, won ? 'You win the match' : 'The opponents win the match'),
      el('p', {}, `${won ? 'Your team' : 'West and East'} cleared A. `
        + `Final levels: you ${RANK_LABEL[game.levels[0]]}, them ${RANK_LABEL[game.levels[1]]}.`),
      el('p', {}, `Across the match you played ${stats.moves} coached moves, `
        + `${stats.best} of them the engine's first choice.`),
      el('div', { class: 'row' },
        el('button', { class: 'primary', onclick: () => { modal.close(); controller.newMatch(); } }, 'New match')));
  });
}

// -- input ------------------------------------------------------------------

$('play').onclick = () => controller.playSelected();
$('pass').onclick = () => controller.pass();
$('hint').onclick = () => controller.hint();
$('group').onclick = () => controller.createGroup();
$('flush').onclick = () => controller.findFlush();
$('clear').onclick = () => controller.clearSelection();
$('new-match').onclick = () => controller.newMatch();

window.addEventListener('keydown', (e) => {
  if (modal.isOpen()) return;
  if (e.key === 'Enter' && !$('play').disabled) controller.playSelected();
  else if (e.key === 'p' && !$('pass').disabled) controller.pass();
  else if (e.key === 'h' && !$('hint').disabled) controller.hint();
  else if (e.key === 'g' && !$('group').disabled) controller.createGroup();
  else if (e.key === 'f' && !$('flush').disabled) controller.findFlush();
  else if (e.key === 'Escape') controller.clearSelection();
});

controller.newMatch();

export { store, controller, engine };
