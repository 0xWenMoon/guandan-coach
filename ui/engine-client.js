// Talks to the engine workers.
//
// Two channels: `table` carries bot moves (latency matters, the player is
// watching an empty table) and `coach` carries reviews and hints (slow is fine).
// They are separate workers, so a 700ms review no longer delays the next move.
//
// Every request carries the generation it was made in. Starting a new match or
// deal bumps the generation and respawns the workers, which both cancels the
// CPU work already in flight and guarantees a late reply can never be applied
// to a game it was not computed for.

export class StaleRequest extends Error {
  constructor() { super('request superseded'); this.stale = true; }
}

const defaultFactory = (url) => new Worker(url, { type: 'module' });

export class EngineClient {
  constructor(url, { channels = ['table', 'coach'], createWorker = defaultFactory } = {}) {
    this.url = url;
    this.createWorker = createWorker;
    this.generation = 0;
    this.names = channels;
    this.channels = new Map();
    for (const name of channels) this.channels.set(name, this.#spawn());
  }

  #spawn() {
    const channel = { worker: this.createWorker(this.url), pending: new Map(), seq: 0 };
    channel.worker.onmessage = (e) => {
      const { id, ok, result, error } = e.data;
      const entry = channel.pending.get(id);
      if (!entry) return;
      channel.pending.delete(id);
      if (entry.generation !== this.generation) return entry.reject(new StaleRequest());
      ok ? entry.resolve(result) : entry.reject(new Error(error));
    };
    channel.worker.onerror = (e) => {
      const err = new Error(e.message ?? 'worker error');
      for (const entry of channel.pending.values()) entry.reject(err);
      channel.pending.clear();
    };
    return channel;
  }

  request(name, cmd, payload) {
    const channel = this.channels.get(name);
    if (!channel) return Promise.reject(new Error(`no such channel: ${name}`));
    const id = ++channel.seq;
    const generation = this.generation;
    return new Promise((resolve, reject) => {
      channel.pending.set(id, { resolve, reject, generation });
      channel.worker.postMessage({ id, cmd, ...payload });
    });
  }

  /** True for "this answer is about a game that no longer exists". */
  static isStale(err) { return !!err?.stale; }

  /**
   * Abandon everything in flight. The workers are terminated rather than just
   * ignored, because `analyze` is synchronous and would otherwise keep burning
   * a core on a position nobody is looking at any more.
   */
  reset() {
    this.generation++;
    for (const [name, channel] of this.channels) {
      for (const entry of channel.pending.values()) entry.reject(new StaleRequest());
      channel.pending.clear();
      channel.worker.terminate?.();
      this.channels.set(name, this.#spawn());
    }
  }

  terminate() {
    this.generation++;
    for (const channel of this.channels.values()) {
      for (const entry of channel.pending.values()) entry.reject(new StaleRequest());
      channel.pending.clear();
      channel.worker.terminate?.();
    }
    this.channels.clear();
  }
}
