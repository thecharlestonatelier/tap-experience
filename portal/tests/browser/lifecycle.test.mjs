/* Lifecycle regression pins: deleting a card removes its PHI feed and
   tombstones the slug, so an old holder cannot write to a later patient. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, seedCard } from './harness.mjs';

let portal;

before(async () => { portal = await startPortal(); });
after(() => portal?.stop());

const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//audit//EN\r\nBEGIN:VEVENT\r\nUID:audit-1\r\nDTSTART:20260101T090000Z\r\nSUMMARY:AUDIT-MARKER\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

async function del(slug, cookie) {
  return fetch(`${portal.base}/api/cards/${slug}`, {
    method: 'DELETE', headers: { Cookie: cookie },
  });
}

test('deleting a card removes its calendar feed', async () => {
  const slug = `lcfeed${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Feed Lifecycle', status: 'active', pens: [{ template: 'glow' }],
  });

  const write = await fetch(`${portal.base}/api/ics/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'text/calendar' }, body: FEED,
  });
  assert.equal(write.status, 204);
  assert.equal((await fetch(`${portal.base}/ics/${slug}`)).status, 200);

  assert.equal((await del(slug, cookie)).status, 204);
  assert.equal((await fetch(`${portal.base}/ics/${slug}`)).status, 404, 'the feed is gone with the card');
});

test('a deleted slug cannot be minted for another patient', async () => {
  const slug = `lcreuse${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Reuse Lifecycle', status: 'active', pens: [{ template: 'glow' }],
  });

  assert.equal((await del(slug, cookie)).status, 204);

  const remint = await fetch(`${portal.base}/api/cards`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Cookie: cookie },
    body: JSON.stringify({ slug, name: 'Second Patient', status: 'active', pens: [{ template: 'bpc' }] }),
  });
  assert.equal(remint.status, 409, 'the deleted slug is tombstoned');
});

test('writes to a deleted slug are refused', async () => {
  const slug = `lcwrite${Date.now().toString(36)}.t`;
  const { cookie } = await seedCard(portal.base, {
    slug, name: 'Write Lifecycle', status: 'active', pens: [{ template: 'glow' }],
  });

  assert.equal((await del(slug, cookie)).status, 204);

  const state = await fetch(`${portal.base}/api/state/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ today: [{ pen: 'x', units: 1, mg: 1, at: '08:00' }] }),
  });
  assert.equal(state.status, 404);

  const dose = await fetch(`${portal.base}/api/dose`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ slug, template: 'glow', units: 1, mg: 1, at: '2026-01-01T09:00:00.000Z', day: '2026-01-01' }),
  });
  assert.equal(dose.status, 404);

  const feed = await fetch(`${portal.base}/api/ics/${slug}`, {
    method: 'POST', headers: { 'Content-Type': 'text/calendar' }, body: FEED,
  });
  assert.equal(feed.status, 404);
});
