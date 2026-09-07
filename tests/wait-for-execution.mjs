import { setTimeout as delay } from 'node:timers/promises';

export async function until(app, predicate) {
  for (let i = 0; i < 300; i++) {
    const snapshot = await app.dispatch('snapshot');
    if (predicate(snapshot)) return snapshot;
    await delay(10);
  }
  throw new Error('execution state did not settle');
}
