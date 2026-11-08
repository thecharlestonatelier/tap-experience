/* Only real push services may receive a reminder. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { allowedPushEndpoint } = require('../../lib/push-endpoint.js');
const { sanitizeSub } = require('../../store/subs.js');

test('only known push-service hosts are allowed', () => {
  assert.equal(allowedPushEndpoint('https://fcm.googleapis.com/wp/abc'), true);
  assert.equal(allowedPushEndpoint('https://web.push.apple.com/abc'), true);
  assert.equal(allowedPushEndpoint('https://updates.push.services.mozilla.com/wpush/v2/abc'), true);
  assert.equal(allowedPushEndpoint('https://wns2-bl2p.notify.windows.com/w/?token=abc'), true);

  assert.equal(allowedPushEndpoint('https://evil.example/collect'), false);
  assert.equal(allowedPushEndpoint('http://fcm.googleapis.com/x'), false);
  assert.equal(allowedPushEndpoint('not-a-url'), false);
  assert.equal(allowedPushEndpoint('https://fcm.googleapis.com.evil.example/x'), false);
});

test('sanitizeSub rejects an arbitrary endpoint', () => {
  const keys = { p256dh: 'x', auth: 'y' };
  assert.equal(sanitizeSub({ sub: { endpoint: 'https://evil.example/x', keys } }, 'a.t'), null);

  const ok = sanitizeSub({ sub: { endpoint: 'https://fcm.googleapis.com/x', keys } }, 'a.t');
  assert.ok(ok);
  assert.equal(ok.sub.endpoint, 'https://fcm.googleapis.com/x');
});
