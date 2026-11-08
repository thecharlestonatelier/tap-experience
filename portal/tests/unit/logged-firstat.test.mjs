/* The `logged-firstat` probe, promoted into the regular suite.

   It used to be a standalone script that needed a running service, a
   studio token in /tmp/tok.txt, and a QA bootstrap. The contract it
   verifies is deterministic, so it belongs here: the reply is exactly
   { days, firstAt }, firstAt is the EARLIEST logged instant per pen even
   when doses arrive out of order, and no dose detail leaks. */
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startPortal, seedCard } from '../browser/harness.mjs';

let portal;

before(async () => { portal = await startPortal(); });
after(() => portal?.stop());

test('the logged reply is { days, firstAt } with the earliest instant and no detail', async () => {
  const slug = `lf${Date.now().toString(36)}.t`;
  const { card } = await seedCard(portal.base, {
    slug, name: 'Logged First', pens: [{ template: 'ghk' }],
    settings: { startDate: '2026-10-20' },
  });
  assert.equal(card.slug, slug);

  const dose = body => fetch(`${portal.base}/api/dose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  // Posted out of order on purpose; each carries detail that must not leak.
  await dose({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, mg: 5, lot: 'LOT-XYZ-1', site: 'Abdomen', at: '2026-10-22T09:30:00.000Z', day: '2026-10-22' });
  await dose({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, mg: 5, lot: 'LOT-XYZ-2', site: 'Thigh', at: '2026-10-20T06:15:00.000Z', day: '2026-10-20' });
  await dose({ slug, template: 'ghk', pen: 'GHK-Cu', units: 10, mg: 5, lot: 'LOT-XYZ-3', site: 'Arm', at: '2026-10-21T08:00:00.000Z', day: '2026-10-21' });

  const log = await (await fetch(`${portal.base}/api/logged/${slug}`)).json();

  assert.equal(log.firstAt?.ghk, '2026-10-20T06:15:00.000Z',
    'firstAt is the earliest instant, not the first posted');
  assert.deepEqual(Object.keys(log).sort(), ['days', 'firstAt'],
    'the reply has exactly the two keys');

  const text = JSON.stringify(log);
  assert.ok(
    !('lot' in log) && !('units' in log) && !('site' in log) && !('mg' in log) &&
    !/lot|units|site|mg|LOT-XYZ|Abdomen|Thigh/i.test(text),
    'no dose detail leaks into the reply',
  );
});
