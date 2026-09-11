// The coach panel.
import { el, text, clear } from '../dom.js';
import { createCardCache } from './cards.js';
import { describeCombo } from '../../src/combos.js';

const LABELS = {
  best: ['Best move', 'best'], good: ['Good', 'good'], fine: ['Fine', 'good'],
  inaccuracy: ['Inaccuracy', 'warn'], mistake: ['Mistake', 'bad'], blunder: ['Blunder', 'bad'],
};

const INTRO = 'Play a card and the engine will tell you whether it was the best move — '
  + 'and if not, what it would have played instead and why.';

export function createCoachView({ body, accuracy }) {
  const cache = createCardCache();

  function ranking(lines, level) {
    const box = el('div', { class: 'lines' }, el('h3', {}, 'Engine ranking'));
    for (const [i, line] of lines.entries()) {
      const label = line.label ?? (line.move ? describeCombo(line.move, level) : 'pass');
      box.append(el('div', { class: `line${i === 0 ? ' top' : ''}` },
        el('span', {}, label + (line.cards ? ` · ${line.cards}` : '')),
        el('span', { class: 'v' }, `${line.value >= 0 ? '+' : ''}${line.value.toFixed(2)}`)));
    }
    return box;
  }

  return function render({ coach, stats, level }) {
    if (stats.moves > 0) {
      text(accuracy, `${stats.best}/${stats.moves} best · avg cost ${(stats.loss / stats.moves).toFixed(2)} lvl`);
    } else {
      text(accuracy, '');
    }

    clear(body);
    if (coach.status === 'idle') return body.append(el('p', { class: 'empty' }, INTRO));
    if (coach.status === 'reviewing') return body.append(el('p', { class: 'empty' }, 'Reviewing your move…'));
    if (coach.status === 'hinting') return body.append(el('p', { class: 'empty' }, 'Thinking…'));
    if (coach.status === 'error') return body.append(el('p', { class: 'empty' }, 'The engine could not answer that one.'));
    if (coach.status === 'note') return body.append(el('p', { class: 'headline' }, coach.text));

    if (coach.status === 'hint') {
      const h = coach.hint;
      body.append(el('p', { class: 'headline' }, h.move
        ? `Engine suggests ${describeCombo(h.move, level)} — selected in your hand.`
        : 'Engine suggests passing here.'));
      body.append(ranking(h.ranked, level));
      return;
    }

    const r = coach.review;
    const [label, tone] = LABELS[r.verdict] ?? ['Reviewed', 'good'];
    body.append(el('div', { class: `verdict ${tone}` }, label));
    body.append(el('p', { class: 'headline' }, r.headline));

    if (r.alternative) {
      const nodes = r.alternative.cards.map((c) => cache.get(c, level, 'mini'));
      body.append(el('div', { class: 'played' },
        el('span', { class: 'lbl' }, `The engine would have played ${describeCombo(r.alternative, level)}:`),
        ...nodes));
    }

    if (r.confident === false) {
      body.append(el('p', { class: 'uncertain' },
        'The top two lines are close enough that the engine cannot really separate them — '
        + 'treat this verdict as a lean, not a ruling.'));
    }

    const ul = el('ul', { class: 'reasons' });
    for (const reason of r.reasons) {
      const li = el('li', {}, reason.text);
      if (reason.principle) {
        li.append(el('span', { class: 'principle' },
          el('b', {}, reason.principle.cn),
          el('span', {}, reason.principle.en)));
      }
      ul.append(li);
    }
    body.append(ul);

    if (r.table?.length) {
      const facts = el('div', { class: 'facts' }, el('h3', {}, 'At the table'));
      for (const f of r.table) {
        facts.append(el('div', { class: 'fact' },
          el('span', { class: 'fl' }, f.label),
          el('span', { class: 'ft' }, f.text)));
      }
      body.append(facts);
    }

    const box = ranking(r.ranked, level);
    box.append(el('div', { class: 'note' },
      `Values are the average level swing over ${r.samples} simulated deals from this exact position `
      + '(+3 = your team wins the deal outright, −3 = the opponents do). Guandan cannot be solved exactly, '
      + 'so these are estimates, not proofs — treat gaps under about 0.2 as noise.'));
    body.append(box);
  };
}
