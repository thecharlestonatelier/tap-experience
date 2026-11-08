/* Two lifecycle scenarios, runnable against the file store and the
   Firestore emulator. They return plain predicates, never patient data. */
import { startPortal, session, mint, call } from './lib.mjs';

const FEED = 'BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//audit//EN\r\nBEGIN:VEVENT\r\nUID:audit-1\r\nDTSTART:20260101T090000Z\r\nSUMMARY:AUDIT-MARKER\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n';

export async function feedDelete(env = {}) {
  const p = await startPortal(env);
  try {
    const cookie = await session(p.base);
    const slug = 'feeddel.t';
    await mint(p.base, cookie, { slug, name: 'Feed Delete', status: 'active', pens: [{ template: 'glow' }] });

    const before = await call(p.base, `/api/ics/${slug}`, { method: 'POST', body: FEED });
    const readBefore = await call(p.base, `/ics/${slug}`);
    const del = await call(p.base, `/api/cards/${slug}`, { method: 'DELETE', cookie });
    const readAfter = await call(p.base, `/ics/${slug}`);

    // Re-mint the same slug for a second, unrelated patient.
    const remint = await call(p.base, '/api/cards', {
      method: 'POST', cookie,
      body: { slug, name: 'Second Patient', status: 'active', pens: [{ template: 'bpc' }] },
    });
    const readReminted = await call(p.base, `/ics/${slug}`);

    const expect = process.env.EXPECT || 'vulnerable';
    return {
      ok: expect === 'blocked'
        ? (readAfter.status === 404 && remint.status === 409)
        : (readAfter.status === 200 && readAfter.text.includes('AUDIT-MARKER')),
      expectation: expect,
      write_status: before.status,
      read_before_delete: readBefore.status,
      delete_status: del.status,
      read_after_delete: readAfter.status,
      feed_survives_delete: readAfter.status === 200 && readAfter.text.includes('AUDIT-MARKER'),
      remint_status: remint.status,
      old_feed_served_to_new_card: readReminted.status === 200 && readReminted.text.includes('AUDIT-MARKER'),
    };
  } finally {
    p.stop();
  }
}

export async function slugReuse(env = {}) {
  const p = await startPortal(env);
  try {
    const cookie = await session(p.base);
    const slug = 'reuse.t';

    await mint(p.base, cookie, { slug, name: 'First Patient', status: 'active', pens: [{ template: 'glow' }] });

    // The first holder writes through the slug-addressed public routes.
    const firstState = await call(p.base, `/api/state/${slug}`, {
      method: 'POST',
      body: { today: [{ pen: 'first-holder-pen', phase: 'first', units: 1, mg: 1, at: '08:00' }], times: { Morning: '08:00' } },
    });
    const firstDose = await call(p.base, '/api/dose', {
      method: 'POST',
      body: { slug, template: 'glow', units: 1, mg: 1, at: '2026-01-01T09:00:00.000Z', day: '2026-01-01' },
    });
    const firstAdded = await call(p.base, `/api/added/${slug}`, {
      method: 'POST', body: { added: [{ id: 'bpc-1', template: 'bpc' }] },
    });

    const del = await call(p.base, `/api/cards/${slug}`, { method: 'DELETE', cookie });
    const remint = await call(p.base, '/api/cards', {
      method: 'POST', cookie,
      body: { slug, name: 'Second Patient', status: 'active', pens: [{ template: 'ghk' }] },
    });

    // The old holder, who still knows the slug, writes again — now against
    // the second patient's record.
    const secondState = await call(p.base, `/api/state/${slug}`, {
      method: 'POST',
      body: { today: [{ pen: 'old-holder-marker', phase: 'poisoned', units: 1, mg: 1, at: '08:00' }], times: { Morning: '09:00' } },
    });
    const secondDose = await call(p.base, '/api/dose', {
      method: 'POST',
      body: { slug, template: 'ghk', units: 2, mg: 2, at: '2026-02-02T09:00:00.000Z', day: '2026-02-02' },
    });
    const secondAdded = await call(p.base, `/api/added/${slug}`, {
      method: 'POST', body: { added: [{ id: 'tb500-1', template: 'tb500' }] },
    });

    const asClinician = await call(p.base, `/api/cards/${slug}`, { cookie });
    const doses = await call(p.base, `/api/doses/${slug}`, { cookie });
    const rec = asClinician.json || {};

    const expect = process.env.EXPECT || 'vulnerable';
    const blocked = remint.status === 409 &&
      secondState.status === 404 && secondDose.status === 404 && secondAdded.status === 404;
    return {
      ok: expect === 'blocked'
        ? blocked
        : (secondState.status === 204 && rec.state && rec.state.today?.[0]?.pen === 'old-holder-marker'),
      expectation: expect,
      first_writes: { state: firstState.status, dose: firstDose.status, added: firstAdded.status },
      delete_status: del.status,
      remint_status: remint.status,
      old_holder_write_after_remint: {
        state: secondState.status,
        dose: secondDose.status,
        added: secondAdded.status,
      },
      new_card_state_poisoned: rec.state?.today?.[0]?.pen === 'old-holder-marker',
      new_card_dose_written_by_old_holder: (doses.json?.doses || []).some(d => d.template === 'ghk' && d.day === '2026-02-02'),
      new_card_added_by_old_holder: (rec.added || []).some(a => ((a && a.template) || a) === 'tb500'),
    };
  } finally {
    p.stop();
  }
}
