/* Pin the Firestore backings against the Firestore emulator. Skipped when
   the emulator is not reachable, so the default unit command stays
   deterministic. Run with:
     firebase emulators:start --only firestore --project atelier-tap
     node --test tests/unit/store.firestore.test.mjs */
import { test } from 'node:test';
import assert from 'node:assert/strict';

const HOST = process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8081';
process.env.FIRESTORE_EMULATOR_HOST = HOST;
process.env.GOOGLE_CLOUD_PROJECT = process.env.GOOGLE_CLOUD_PROJECT || 'atelier-tap';
process.env.CARD_STORE = 'firestore';
const suffix = Date.now();
process.env.CARD_COLLECTION = `cards-test-${suffix}`;
process.env.DOSE_COLLECTION = `doses-test-${suffix}`;
process.env.FEED_COLLECTION = `feeds-test-${suffix}`;
process.env.SUB_COLLECTION = `subs-test-${suffix}`;

const reachable = await (async () => {
  try { await fetch(`http://${HOST}/`, { signal: AbortSignal.timeout(2000) }); return true; }
  catch { return false; }
})();

if (!reachable) {
  test('store firestore pin (skipped: no firestore emulator)', { skip: `firestore emulator not reachable at ${HOST}` }, () => {});
} else {
  const storeIndex = await import('../../store/index.js');
  const dosesMod = await import('../../store/doses.js');
  const feedsMod = await import('../../store/feeds.js');
  const subsMod = await import('../../store/subs.js');

  const store = storeIndex.openStore();
  const doses = dosesMod.openDoses();
  const feeds = feedsMod.openFeeds();
  const subs = subsMod.openSubs();
  const now = new Date().toISOString();
  const rec = slug => ({ slug, name: slug, status: 'active', startDate: null, note: '',
                         pens: [], added: [], dropped: [], createdAt: now, updatedAt: now });

  test('the selectors return the firestore backing', () => {
    assert.equal(store.kind, 'firestore');
    assert.equal(doses.kind, 'firestore');
    assert.equal(feeds.kind, 'firestore');
    assert.equal(subs.kind, 'firestore');
  });

  test('firestore store pings', async () => {
    await store.ping();
  });

  test('firestore store puts, gets, lists and removes', async () => {
    await store.put(rec('a.one'));
    const got = await store.get('a.one');
    assert.equal(got.slug, 'a.one');
    assert.ok((await store.list()).some(r => r.slug === 'a.one'));
    await store.remove('a.one');
    assert.equal(await store.get('a.one'), null);
  });

  test('firestore touch increments the counters', async () => {
    await store.put(rec('t.one'));
    await store.touch('t.one', '2026-03-01');
    const got = await store.get('t.one');
    assert.equal(got.taps, 1);
    assert.equal(got.days['2026-03-01'], 1);
    await store.remove('t.one');
  });

  test('firestore setState merges the state', async () => {
    await store.put(rec('s.one'));
    await store.setState('s.one', { startDate: '2026-01-01' });
    const got = await store.get('s.one');
    assert.deepEqual(got.state, { startDate: '2026-01-01' });
    await store.remove('s.one');
  });

  test('firestore activate links once, verifies, blocks, misses and unlinks', async () => {
    await store.put(rec('act.one'));
    assert.deepEqual(await store.activate('act.one', { uid: 'u1' }), { result: 'linked' });
    assert.deepEqual(await store.activate('act.one', { uid: 'u1' }), { result: 'verified' });
    assert.deepEqual(await store.activate('act.one', { uid: 'u2' }), { result: 'blocked' });
    assert.deepEqual(await store.activate('nope.x', { uid: 'u1' }), { result: 'missing' });
    await store.unlink('act.one');
    assert.equal((await store.get('act.one')).activatedBy, undefined);
    await store.remove('act.one');
  });

  test('firestore doses put and read back by slug', async () => {
    const dose = { slug: 'd.one', template: 'ghk', day: '2026-03-01', at: '2026-03-01T20:00:00Z', units: 10 };
    const first = await doses.put(dose);
    assert.equal(first.duplicate, false);
    assert.equal((await doses.put(dose)).duplicate, true);
    const rows = await doses.forSlug('d.one');
    assert.equal(rows.length, 1);
  });

  test('firestore feeds put, get and remove', async () => {
    await feeds.put('f.one', 'BEGIN:VCALENDAR\nEND:VCALENDAR');
    const feed = await feeds.get('f.one');
    assert.equal(feed.text, 'BEGIN:VCALENDAR\nEND:VCALENDAR');
    await feeds.remove('f.one');
    assert.equal(await feeds.get('f.one'), null);
  });

  test('firestore subs put, read, mark sent and remove', async () => {
    const sub = { id: 'sub1', slug: 'x.one', sub: { endpoint: 'https://e/x', keys: { p256dh: 'p', auth: 'a' } },
                  due: [], sentUpTo: '', tz: '', createdAt: now, updatedAt: now };
    const saved = await subs.put(sub);
    assert.equal(saved.slug, 'x.one');
    assert.equal((await subs.forSlug('x.one')).length, 1);
    assert.ok((await subs.listAll()).some(r => r.id === 'sub1'));
    await subs.markSent('sub1', '2026-03-01T00:00:00.000Z');
    await subs.remove('sub1');
    assert.equal((await subs.forSlug('x.one')).length, 0);
  });
}
