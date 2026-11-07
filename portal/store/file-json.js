/* ==================================================================
   A JSON FILE, READ AND WRITTEN
   ------------------------------------------------------------------
   The file backing every store on a laptop: cards, administrations,
   reminders, feeds. Missing or unreadable means an empty object, so a
   fresh checkout works with nothing seeded. Kept in one place so the four
   stores cannot drift in how they read and write it.
   ================================================================== */

const fs = require('node:fs');
const path = require('node:path');

function fileJson(target) {
  const readAll = () => {
    try { return JSON.parse(fs.readFileSync(target, 'utf8')); }
    catch { return {}; }
  };
  const writeAll = all => {
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, JSON.stringify(all, null, 2));
  };
  return { readAll, writeAll };
}

module.exports = { fileJson };
