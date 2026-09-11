// One state object, one way to change it, one notification.

export function createStore(initial) {
  let state = initial;
  const subscribers = new Set();
  let notifying = false;
  let dirty = false;

  function notify() {
    if (notifying) { dirty = true; return; }  // never re-enter mid-render
    notifying = true;
    try {
      do {
        dirty = false;
        for (const fn of subscribers) fn(state);
      } while (dirty);
    } finally {
      notifying = false;
    }
  }

  return {
    get: () => state,
    set(patch) {
      const next = typeof patch === 'function' ? patch(state) : patch;
      let changed = false;
      for (const k of Object.keys(next)) if (state[k] !== next[k]) { changed = true; break; }
      if (!changed) return state;
      state = { ...state, ...next };
      notify();
      return state;
    },
    /** The Game object mutates in place, so bump a counter to force a redraw. */
    touch() {
      state = { ...state, version: state.version + 1 };
      notify();
    },
    subscribe(fn) {
      subscribers.add(fn);
      return () => subscribers.delete(fn);
    },
  };
}
