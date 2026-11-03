import assert from 'node:assert/strict';
import fs from 'node:fs';

const script = fs.readFileSync(new URL('../tools/retention-cleanup.sh', import.meta.url), 'utf8');
assert.ok(script.includes("interval '3 days'"), 'messages and mailboxes must use 3-day retention');
assert.ok(script.includes('DELETE FROM public.messages'), 'expired messages must still be pruned');
assert.ok(script.includes('m.access_code IS NULL'), 'mailboxes with an access code must be kept');
assert.ok(script.includes('NOT EXISTS (SELECT 1 FROM public.messages'), 'only empty mailboxes are pruned');
assert.ok(script.includes('VACUUM (ANALYZE) public.mailboxes'), 'mailboxes table must be vacuumed');

console.log('retention-cleanup: all assertions passed');
