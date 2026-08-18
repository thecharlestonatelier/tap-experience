#!/usr/bin/env node
/* Generate the VAPID key pair the reminder service signs with.
 *
 *   node portal/scripts/push-keys.js
 *
 * Run once. The public half is handed to every phone that subscribes; the
 * private half is a secret and belongs in Secret Manager, never the repo.
 *
 * Regenerating them invalidates every subscription that exists — every
 * patient would have to turn reminders on again — so keep the pair.
 */
const { generateKeys } = require('../lib/push');

const { publicKey, privateKey } = generateKeys();

console.log(`
VAPID_PUBLIC_KEY   ${publicKey}
VAPID_PRIVATE_KEY  ${privateKey}

Store them, from the repository root:

  printf '%s' '${publicKey}' | \\
    gcloud secrets create vapid-public-key --data-file=-
  printf '%s' '${privateKey}' | \\
    gcloud secrets create vapid-private-key --data-file=-

Then bash portal/setup.sh, which wires them into the service.

The private key is a secret. If it appears in a chat, a ticket or a
commit, generate a new pair — and know that doing so turns every existing
patient's reminders off until each of them switches them back on.
`);
