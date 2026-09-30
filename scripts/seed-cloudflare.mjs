import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run seed:cloudflare -- config/subscriptions.json');
  process.exit(2);
}
const workerUrl = String(process.env.WORKER_URL || '').replace(/\/$/, '');
const adminToken = process.env.ADMIN_TOKEN || '';
if (!/^https:\/\//.test(workerUrl) || !adminToken) {
  console.error('WORKER_URL and ADMIN_TOKEN must be present in the current shell.');
  process.exit(2);
}

const payload = JSON.parse(readFileSync(resolve(input), 'utf8'));
const subscriptions = Array.isArray(payload) ? payload : payload.subscriptions;
if (!Array.isArray(subscriptions)) throw new Error('Subscription file must be an array or contain subscriptions[].');

let added = 0;
for (const subscription of subscriptions) {
  if (subscription?.enabled === false) continue;
  const response = await fetch(`${workerUrl}/api/creators`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${adminToken}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ url: subscription.url || subscription.sec_uid, label: subscription.label || '' }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`Failed to seed ${subscription.label || subscription.url}: ${result.error || response.status}`);
  added += 1;
  console.log(`✓ ${result.label || result.sec_uid}`);
}
console.log(`Seed complete: ${added} enabled creator(s). The first poll establishes a baseline and sends no notification.`);
