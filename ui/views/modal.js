import { clear } from '../dom.js';

export function createModalView(root, sheet) {
  return {
    open(build) {
      clear(sheet);
      build(sheet);
      root.classList.remove('hidden');
    },
    close() { root.classList.add('hidden'); },
    isOpen() { return !root.classList.contains('hidden'); },
  };
}
