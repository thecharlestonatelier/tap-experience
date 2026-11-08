/* Lead 4: a deleted slug can be re-minted for a new patient while the old
   holder keeps write authority. */
import { slugReuse } from './scenarios.mjs';
import { guard } from './lib.mjs';

guard('slug-reuse', () => slugReuse({ CARD_STORE: 'file' }));
