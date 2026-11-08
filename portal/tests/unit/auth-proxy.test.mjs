/* The auth-helper proxy never forwards the clinician session or a bearer
   credential to the Firebase auth host. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { authProxyHeaders, stripClinicianCookie } = require('../../lib/auth-proxy.js');

test('strips only the ca_studio cookie and keeps the others', () => {
  assert.equal(
    stripClinicianCookie('ca_studio=abc.def; firebase=1; theme=dark'),
    'firebase=1; theme=dark');
  assert.equal(stripClinicianCookie('ca_studio=abc'), '');
  assert.equal(stripClinicianCookie('CA_STUDIO=abc; keep=1'), 'keep=1');
  assert.equal(stripClinicianCookie(''), '');
});

test('drops host, hop-by-hop, authorization, and the clinician cookie', () => {
  const out = authProxyHeaders({
    host: 'example.test',
    connection: 'keep-alive',
    authorization: 'Bearer clinician-token',
    cookie: 'ca_studio=abc.def; firebase=1',
    'x-client': 'ok',
  });
  assert.deepEqual(out, { cookie: 'firebase=1', 'x-client': 'ok' });
});

test('drops the cookie header entirely when it only held ca_studio', () => {
  const out = authProxyHeaders({ Cookie: 'ca_studio=abc', Authorization: 'Bearer x' });
  assert.deepEqual(out, {});
});
