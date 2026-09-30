const workerUrl = String(process.env.WORKER_URL || '').replace(/\/$/, '');
if (!/^https:\/\//.test(workerUrl)) {
  console.error('WORKER_URL must be set to the deployed Worker origin.');
  process.exit(2);
}

const response = await fetch(`${workerUrl}/health`, { signal: AbortSignal.timeout(10_000) });
const health = await response.json().catch(() => ({}));
const cycleAt = Date.parse(health.last_cycle?.at || '');
const ageMs = Number.isFinite(cycleAt) ? Date.now() - cycleAt : Number.POSITIVE_INFINITY;
const report = {
  checked_at: new Date().toISOString(),
  http_status: response.status,
  service_status: health.status || 'unknown',
  active_creators: health.active_creators ?? null,
  pending_deliveries: health.pending_deliveries ?? null,
  last_cycle_age_seconds: Number.isFinite(ageMs) ? Math.round(ageMs / 1000) : null,
  last_cycle: health.last_cycle || null,
};
console.log(JSON.stringify(report, null, 2));

if (!response.ok || health.status !== 'ok' || health.last_cycle?.error || ageMs > 5 * 60_000) {
  process.exitCode = 1;
}
