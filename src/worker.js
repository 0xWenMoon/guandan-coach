// The engine runs here so the table stays responsive while it thinks.
import { handle } from './engine-api.js';

self.onmessage = (e) => {
  const { id } = e.data;
  try {
    self.postMessage({ id, ok: true, result: handle(e.data) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: `${err.message}\n${err.stack}` });
  }
};
