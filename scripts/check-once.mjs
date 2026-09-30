import { DouyinHttpClient, normalizeLiveProfile, normalizeSecUid } from '@douyin-live-alert/core';

const input = process.argv[2];
if (!input) {
  console.error('Usage: npm run check -- <sec_uid-or-profile-url>');
  process.exit(2);
}

const secUid = normalizeSecUid(input);
const started = Date.now();
const client = new DouyinHttpClient({ timeoutMs: 10_000 });
const payload = await client.fetchProfile(secUid);
const snapshot = normalizeLiveProfile(payload, secUid);
console.log(JSON.stringify({ ...snapshot, duration_ms: Date.now() - started }, null, 2));
