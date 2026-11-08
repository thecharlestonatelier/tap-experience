/* Lead 3: deleting a card does not delete its calendar feed. */
import { feedDelete } from './scenarios.mjs';
import { guard } from './lib.mjs';

guard('feed-delete', () => feedDelete({ CARD_STORE: 'file' }));
