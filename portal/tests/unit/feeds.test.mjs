/* Characterization pin for portal/store/feeds.js.
   A calendar feed is a whole iCalendar file or nothing. */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import feeds from '../../store/feeds.js';

test('sanitizeFeed keeps a whole VCALENDAR', () => {
  assert.equal(feeds.sanitizeFeed('BEGIN:VCALENDAR\nEND:VCALENDAR'),
    'BEGIN:VCALENDAR\nEND:VCALENDAR');
});

test('sanitizeFeed rejects a file missing BEGIN or END', () => {
  assert.equal(feeds.sanitizeFeed('END:VCALENDAR'), null);
  assert.equal(feeds.sanitizeFeed('BEGIN:VCALENDAR\nX'), null);
});

test('sanitizeFeed rejects null and empty', () => {
  assert.equal(feeds.sanitizeFeed(null), null);
  assert.equal(feeds.sanitizeFeed(''), null);
});
