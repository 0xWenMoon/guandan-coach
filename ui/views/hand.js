// Your hand, laid out the way Guandan players actually arrange cards:
// one column per rank, cards of that rank standing vertically inside it,
// strongest rank on the left. Only the top-left corner of a stacked card is
// visible, which is why the card face puts its index there.
//
// User-made groups (a full house you have decided to keep together, say) are
// lifted out of the columns and shown as their own boxes on the left.
import { el, reconcile, toggle } from '../dom.js';
import { createCardCache } from './cards.js';

function setVar(node, name, value) {
  if (node.style.getPropertyValue(name) !== value) node.style.setProperty(name, value);
}

export function createHandView(root, { onToggle, onDissolveGroup = () => {} }) {
  const cache = createCardCache();
  const colCache = new Map();
  const groupCache = new Map();
  const grouped = el('div', { class: 'grouped' });
  const columns = el('div', { class: 'columns' });
  root.append(grouped, columns);

  const cardAt = (e) => (e.target.closest ? e.target.closest('.card') : null);

  root.addEventListener('click', (e) => {
    const x = e.target.closest ? e.target.closest('.gx') : null;
    if (x) { e.stopPropagation(); onDissolveGroup(x.dataset.group); return; }
    if (root.dataset.interactive !== 'true') return;
    const node = cardAt(e);
    if (node?.dataset.id) onToggle(node.dataset.id);
  });

  root.addEventListener('keydown', (e) => {
    if (root.dataset.interactive !== 'true') return;
    if (e.key !== ' ' && e.key !== 'Spacebar') return;
    const node = cardAt(e);
    if (!node?.dataset.id) return;
    e.preventDefault();
    e.stopPropagation();
    onToggle(node.dataset.id);
  });

  function cardNode(card, level, selected, highlight, interactive, depth) {
    const node = cache.get(card, level, '');
    toggle(node, 'sel', selected.has(card.id));
    toggle(node, 'hot', !!highlight && highlight.has(card.id));
    setVar(node, '--depth', String(depth));
    node.tabIndex = interactive ? 0 : -1;
    node.setAttribute('role', interactive ? 'button' : 'img');
    node.setAttribute('aria-pressed', selected.has(card.id) ? 'true' : 'false');
    return node;
  }

  return function render({ cards, level, selected, interactive, groups = [], highlight = null }) {
    root.dataset.interactive = interactive ? 'true' : 'false';
    toggle(root, 'locked', !interactive);

    const claimed = new Set(groups.flatMap((g) => g.cardIds));
    const byId = new Map(cards.map((c) => [c.id, c]));

    // --- user groups, pulled out of the columns
    const groupNodes = [];
    for (const group of groups) {
      let box = groupCache.get(group.id);
      if (!box) {
        box = el('div', { class: 'cgroup' },
          el('div', { class: 'gcards' }),
          el('div', { class: 'glabel' },
            el('span', { class: 'gtext' }),
            el('button', { class: 'gx', dataset: { group: group.id }, title: 'Ungroup' }, '×')));
        groupCache.set(group.id, box);
      }
      const members = group.cardIds.map((id) => byId.get(id)).filter(Boolean);
      reconcile(box.querySelector('.gcards'),
        members.map((c, i) => cardNode(c, level, selected, highlight, interactive, i)));
      box.querySelector('.gtext').textContent = group.label;
      toggle(box, 'sel', members.length > 0 && members.every((c) => selected.has(c.id)));
      groupNodes.push(box);
    }
    reconcile(grouped, groupNodes);
    toggle(grouped, 'empty', groupNodes.length === 0);
    for (const id of [...groupCache.keys()]) {
      if (!groups.some((g) => g.id === id)) groupCache.delete(id);
    }

    // --- the rest, one column per rank
    const loose = cards.filter((c) => !claimed.has(c.id));
    const cols = [];
    for (const card of loose) {
      const last = cols[cols.length - 1];
      if (last && last.rank === card.rank) last.cards.push(card);
      else cols.push({ rank: card.rank, cards: [card] });
    }

    const colNodes = cols.map(({ rank, cards: inCol }) => {
      let node = colCache.get(rank);
      if (!node) { node = el('div', { class: 'col' }); colCache.set(rank, node); }
      reconcile(node, inCol.map((c, i) => cardNode(c, level, selected, highlight, interactive, i)));
      return node;
    });
    reconcile(columns, colNodes);

    const live = new Set(cols.map((c) => c.rank));
    for (const rank of [...colCache.keys()]) if (!live.has(rank)) colCache.delete(rank);
    cache.prune(new Set(cards.map((c) => c.id)));
  };
}
