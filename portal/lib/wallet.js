/* ==================================================================
   APPLE WALLET
   ------------------------------------------------------------------
   A second way into the same card. The physical tag stays what it is;
   this puts a pass in the patient's Wallet carrying her name, today's
   dose, and a QR of her card address — so the portal is one swipe from
   the lock screen even when the card is in a drawer.

   A .pkpass is a zip of JSON and images, plus a manifest of SHA-1
   digests, plus a PKCS#7 detached signature over that manifest. The
   first two this file builds outright. The third needs certificates
   that only the practice's Apple Developer account can issue, so
   `sign()` shells out to openssl against files supplied at runtime —
   see WALLET.md for how to get them.

   NOTE ON NFC: passes can carry an NFC payload, but Apple restricts
   that entitlement to access, transit and payment partners. It is not
   available here and it is not needed — the plastic card is the NFC
   surface, and this is the pocket copy.
   ================================================================== */

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { execFileSync } = require('node:child_process');

const PASS_TYPE_ID = process.env.PASS_TYPE_ID || '';       // pass.com.thecharlestonatelier.card
const TEAM_ID = process.env.APPLE_TEAM_ID || '';
const CERT_DIR = process.env.PASS_CERT_DIR || '/secrets/wallet';
const ORG = 'The Charleston Atelier';

/* The atelier's colours, as Wallet wants them. */
const INK = 'rgb(59, 46, 32)';
const IVORY = 'rgb(243, 235, 225)';
const BRASS = 'rgb(138, 115, 80)';

function configured() {
  return !!(PASS_TYPE_ID && TEAM_ID &&
    fs.existsSync(path.join(CERT_DIR, 'pass.pem')) &&
    fs.existsSync(path.join(CERT_DIR, 'wwdr.pem')));
}

/* ---------- pass.json ----------
   A storeCard: no dates, no boarding, just a standing card the patient
   keeps. `authenticationToken` and `webServiceURL` are what let the pass
   refresh itself when a dose changes; both are omitted until the update
   service is running, and Wallet is happy without them. */
function buildPassJson(card, { origin, dose }) {
  const url = `${origin}/${card.slug}`;

  const pass = {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_ID,
    teamIdentifier: TEAM_ID,
    organizationName: ORG,
    description: `${ORG} — patient card`,
    serialNumber: card.slug,

    backgroundColor: IVORY,
    foregroundColor: INK,
    labelColor: BRASS,

    logoText: ORG,

    barcodes: [{
      format: 'PKBarcodeFormatQR',
      message: url,
      messageEncoding: 'iso-8859-1',
      altText: card.slug
    }],

    associatedStoreIdentifiers: [],

    storeCard: {
      headerFields: dose ? [{
        key: 'today',
        label: dose.lead,                 // "Turn your pen to" / "Draw up to"
        value: String(dose.units)
      }] : [],
      primaryFields: [{
        key: 'patient',
        label: 'Patient',
        value: card.name || 'Not yet set up'
      }],
      secondaryFields: dose ? [{
        key: 'pen',
        label: 'Today',
        value: dose.penName
      }] : [],
      auxiliaryFields: card.startDate ? [{
        key: 'started',
        label: 'Started',
        value: card.startDate,
        dateStyle: 'PKDateStyleMedium'
      }] : [],
      backFields: [
        { key: 'portal', label: 'Your portal', value: url },
        { key: 'concierge', label: 'The atelier', value: '843-377-3713' },
        { key: 'note', label: 'About this card',
          value: 'Your dosing is kept up to date by the atelier. Open the portal '
               + 'for today\'s instructions, your schedule and your supply.' }
      ]
    }
  };

  return pass;
}

/* ---------- bundle ----------
   Every file in the pass is hashed into manifest.json; the signature is
   over the manifest, which is what ties the images and the JSON together. */
function buildManifest(files) {
  const manifest = {};
  for (const [name, buf] of Object.entries(files)) {
    manifest[name] = crypto.createHash('sha1').update(buf).digest('hex');
  }
  return manifest;
}

/* Detached PKCS#7, DER encoded, over manifest.json. openssl is present in
   the node:20-slim image; the certificates are mounted from Secret Manager. */
function sign(manifestBuffer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pkpass-'));
  const manifestPath = path.join(dir, 'manifest.json');
  const sigPath = path.join(dir, 'signature');
  try {
    fs.writeFileSync(manifestPath, manifestBuffer);
    const args = [
      'smime', '-binary', '-sign',
      '-certfile', path.join(CERT_DIR, 'wwdr.pem'),
      '-signer', path.join(CERT_DIR, 'pass.pem'),
      '-inkey', path.join(CERT_DIR, 'pass.key'),
      '-in', manifestPath,
      '-out', sigPath,
      '-outform', 'DER'
    ];
    if (process.env.PASS_KEY_PASSPHRASE) {
      args.push('-passin', `pass:${process.env.PASS_KEY_PASSPHRASE}`);
    }
    execFileSync('openssl', args, { stdio: 'pipe' });
    return fs.readFileSync(sigPath);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

/* ---------- zip ----------
   A .pkpass is a plain stored (uncompressed) zip. Writing it by hand keeps
   the service dependency-free; the format is small and fixed. */
function zip(files) {
  const entries = [];
  const chunks = [];
  let offset = 0;

  for (const [name, data] of Object.entries(files)) {
    const nameBuf = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);          // version needed
    local.writeUInt16LE(0, 6);           // flags
    local.writeUInt16LE(0, 8);           // stored, no compression
    local.writeUInt16LE(0, 10);          // time
    local.writeUInt16LE(0, 12);          // date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);

    chunks.push(local, nameBuf, data);
    entries.push({ name: nameBuf, crc, size: data.length, offset });
    offset += local.length + nameBuf.length + data.length;
  }

  const centralStart = offset;
  for (const e of entries) {
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(e.crc, 16);
    central.writeUInt32LE(e.size, 20);
    central.writeUInt32LE(e.size, 24);
    central.writeUInt16LE(e.name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(e.offset, 42);
    chunks.push(central, e.name);
    offset += central.length + e.name.length;
  }

  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(offset - centralStart, 12);
  end.writeUInt32LE(centralStart, 16);
  end.writeUInt16LE(0, 20);
  chunks.push(end);

  return Buffer.concat(chunks);
}

let CRC_TABLE = null;
function crc32(buf) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
      CRC_TABLE[i] = c;
    }
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ buf[i]) & 0xFF];
  return (crc ^ -1) >>> 0;
}

/* ---------- assembly ---------- */

/* The pass artwork. Wallet requires icon.png at minimum; logo.png is what
   shows across the top. Both are read from portal/wallet-assets if present,
   so the real CA monogram can be dropped in without touching this file. */
function artwork() {
  const dir = process.env.PASS_ASSET_DIR || path.join(__dirname, '..', 'wallet-assets');
  const out = {};
  for (const name of ['icon.png', 'icon@2x.png', 'logo.png', 'logo@2x.png']) {
    const f = path.join(dir, name);
    if (fs.existsSync(f)) out[name] = fs.readFileSync(f);
  }
  return out;
}

function buildPass(card, opts) {
  if (!configured()) {
    throw Object.assign(
      new Error('wallet_not_configured'),
      { status: 503, detail: 'Pass Type ID, team id and certificates are not in place. See WALLET.md.' });
  }

  const art = artwork();
  if (!art['icon.png']) {
    throw Object.assign(new Error('wallet_missing_icon'), { status: 503 });
  }

  const files = Object.assign({}, art);
  files['pass.json'] = Buffer.from(JSON.stringify(buildPassJson(card, opts), null, 2));

  const manifest = Buffer.from(JSON.stringify(buildManifest(files), null, 2));
  files['manifest.json'] = manifest;
  files['signature'] = sign(manifest);

  return zip(files);
}

module.exports = { buildPass, buildPassJson, buildManifest, zip, crc32, configured };
