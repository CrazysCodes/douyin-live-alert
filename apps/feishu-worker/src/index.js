import {
  DouyinHttpClient,
  FeishuAppClient,
  buildLiveAlert,
  classifyLiveTransition,
  liveEventKey,
  nextLiveState,
  normalizeLiveProfile,
  normalizeSecUid,
} from '@douyin-live-alert/core';

const jsonHeaders = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: jsonHeaders });
}

function positiveInt(value, fallback, maximum = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.min(parsed, maximum) : fallback;
}

function stateFromRow(row) {
  if (!row?.initialized_at) return null;
  return {
    initialized_at: row.initialized_at,
    last_stable_status: row.last_stable_status,
    room_id: row.room_id,
    nickname: row.nickname,
    title: row.title,
    live_url: row.live_url,
    last_checked_at: row.last_checked_at,
    last_live_started_at: row.last_live_started_at,
    error: row.error,
  };
}

async function mapConcurrent(items, concurrency, task) {
  const results = new Array(items.length);
  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const index = cursor++;
      try {
        results[index] = { status: 'fulfilled', value: await task(items[index], index) };
      } catch (reason) {
        results[index] = { status: 'rejected', reason };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  return results;
}

async function acquireLease(db, owner, nowMs, leaseMs = 55_000) {
  const result = await db.prepare(`
    INSERT INTO scheduler_locks(name, lease_until, owner)
    VALUES ('poll', ?1, ?2)
    ON CONFLICT(name) DO UPDATE SET lease_until = excluded.lease_until, owner = excluded.owner
    WHERE scheduler_locks.lease_until < ?3
  `).bind(nowMs + leaseMs, owner, nowMs).run();
  return Number(result.meta?.changes || 0) === 1;
}

async function releaseLease(db, owner) {
  await db.prepare("DELETE FROM scheduler_locks WHERE name = 'poll' AND owner = ?1").bind(owner).run();
}

async function getRuntimeValue(db, key) {
  const row = await db.prepare('SELECT value FROM runtime_config WHERE key = ?1').bind(key).first();
  return row?.value || '';
}

async function setRuntimeValue(db, key, value, now) {
  await db.prepare(`
    INSERT INTO runtime_config(key, value, updated_at) VALUES (?1, ?2, ?3)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at
  `).bind(key, value, now).run();
}

async function dueCreators(env, now) {
  const interval = positiveInt(env.POLL_INTERVAL_SECONDS, 60, 3600);
  const batchSize = positiveInt(env.POLL_BATCH_SIZE, 12, 24);
  const cutoff = new Date(Date.parse(now) - interval * 1000).toISOString();
  const query = await env.DB.prepare(`
    SELECT c.sec_uid, c.label,
           s.initialized_at, s.last_stable_status, s.room_id, s.nickname,
           s.title, s.live_url, s.last_checked_at, s.last_live_started_at, s.error
    FROM creators c
    LEFT JOIN creator_states s ON s.sec_uid = c.sec_uid
    WHERE c.enabled = 1 AND (s.last_checked_at IS NULL OR s.last_checked_at = '' OR s.last_checked_at <= ?1)
    ORDER BY COALESCE(s.last_checked_at, '') ASC, c.created_at ASC
    LIMIT ?2
  `).bind(cutoff, batchSize).all();
  return query.results || [];
}

function stateStatement(db, secUid, state) {
  return db.prepare(`
    INSERT INTO creator_states(
      sec_uid, initialized_at, last_stable_status, room_id, nickname, title,
      live_url, last_checked_at, last_live_started_at, error
    ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
    ON CONFLICT(sec_uid) DO UPDATE SET
      initialized_at = excluded.initialized_at,
      last_stable_status = excluded.last_stable_status,
      room_id = excluded.room_id,
      nickname = excluded.nickname,
      title = excluded.title,
      live_url = excluded.live_url,
      last_checked_at = excluded.last_checked_at,
      last_live_started_at = excluded.last_live_started_at,
      error = excluded.error
  `).bind(
    secUid, state.initialized_at, state.last_stable_status, state.room_id, state.nickname,
    state.title, state.live_url, state.last_checked_at, state.last_live_started_at, state.error,
  );
}

function deliveryStatement(db, eventKey, secUid, payload, now) {
  return db.prepare(`
    INSERT OR IGNORE INTO deliveries(
      event_key, sec_uid, event_type, payload_json, status, attempts, next_retry_at, created_at
    ) VALUES (?1, ?2, 'live_started', ?3, 'pending', 0, 0, ?4)
  `).bind(eventKey, secUid, JSON.stringify(payload), now);
}

async function checkCreator(env, client, creator, now) {
  const previous = stateFromRow(creator);
  try {
    const profile = await client.fetchProfile(creator.sec_uid);
    const snapshot = normalizeLiveProfile(profile, creator.sec_uid, new Date(now));
    const event = classifyLiveTransition(previous, snapshot);
    const next = nextLiveState(previous, snapshot, now);
    const statements = [
      stateStatement(env.DB, creator.sec_uid, next),
      env.DB.prepare('UPDATE creators SET label = CASE WHEN label = \'\' THEN ?1 ELSE label END, updated_at = ?2 WHERE sec_uid = ?3')
        .bind(snapshot.nickname, now, creator.sec_uid),
    ];
    if (event === 'live_started') {
      statements.push(deliveryStatement(
        env.DB,
        liveEventKey(snapshot),
        creator.sec_uid,
        buildLiveAlert(snapshot, creator.label),
        now,
      ));
    }
    await env.DB.batch(statements);
    return { sec_uid: creator.sec_uid, status: snapshot.status, event };
  } catch (error) {
    const fallback = {
      initialized_at: previous?.initialized_at || '',
      last_stable_status: previous?.last_stable_status || 'unknown',
      room_id: previous?.room_id || '',
      nickname: previous?.nickname || creator.label || '',
      title: previous?.title || '',
      live_url: previous?.live_url || `https://www.douyin.com/user/${creator.sec_uid}`,
      last_checked_at: now,
      last_live_started_at: previous?.last_live_started_at || '',
      error: error instanceof Error ? error.message : String(error),
    };
    await stateStatement(env.DB, creator.sec_uid, fallback).run();
    throw error;
  }
}

async function flushDeliveries(env, nowMs) {
  const pending = await env.DB.prepare(`
    SELECT event_key, payload_json, attempts
    FROM deliveries
    WHERE status IN ('pending', 'retry') AND attempts < 5 AND next_retry_at <= ?1
    ORDER BY created_at ASC
    LIMIT 20
  `).bind(nowMs).all();
  const rows = pending.results || [];
  const concurrency = positiveInt(env.DELIVERY_CONCURRENCY, 3, 5);
  const feishu = new FeishuAppClient({
    appId: env.FEISHU_APP_ID,
    appSecret: env.FEISHU_APP_SECRET,
    receiveId: env.FEISHU_RECEIVE_ID,
    receiveIdType: env.FEISHU_RECEIVE_ID_TYPE || 'open_id',
  });
  const results = await mapConcurrent(rows, concurrency, async row => {
    try {
      const payload = JSON.parse(row.payload_json);
      await feishu.sendText(payload.text);
      await env.DB.prepare(`
        UPDATE deliveries SET status = 'sent', attempts = attempts + 1, sent_at = ?1, error = ''
        WHERE event_key = ?2 AND status != 'sent'
      `).bind(new Date(nowMs).toISOString(), row.event_key).run();
      return { event_key: row.event_key, status: 'sent' };
    } catch (error) {
      const attempts = Number(row.attempts || 0) + 1;
      const retryAt = nowMs + Math.min(30 * 60_000, 30_000 * 2 ** (attempts - 1));
      await env.DB.prepare(`
        UPDATE deliveries SET status = 'retry', attempts = ?1, next_retry_at = ?2, error = ?3
        WHERE event_key = ?4
      `).bind(attempts, retryAt, error.message, row.event_key).run();
      throw error;
    }
  });
  return {
    selected: rows.length,
    sent: results.filter(item => item.status === 'fulfilled').length,
    failed: results.filter(item => item.status === 'rejected').length,
  };
}

export async function runCycle(env, options = {}) {
  const nowMs = options.nowMs ?? Date.now();
  const now = new Date(nowMs).toISOString();
  const owner = options.owner || crypto.randomUUID();
  if (!await acquireLease(env.DB, owner, nowMs)) return { skipped: true, reason: 'lease_held' };
  const started = Date.now();
  try {
    const creators = await dueCreators(env, now);
    const savedTtwid = await getRuntimeValue(env.DB, 'douyin_ttwid');
    const client = new DouyinHttpClient({ timeoutMs: 10_000, ttwid: savedTtwid });
    if (creators.length && !client.ttwid) await client.getTtwid();
    const concurrency = positiveInt(env.POLL_CONCURRENCY, 5, 5);
    const checks = await mapConcurrent(creators, concurrency, creator => checkCreator(env, client, creator, now));
    if (client.ttwid && client.ttwid !== savedTtwid) await setRuntimeValue(env.DB, 'douyin_ttwid', client.ttwid, now);
    const deliveries = await flushDeliveries(env, nowMs);
    const summary = {
      skipped: false,
      creators: creators.length,
      successes: checks.filter(item => item.status === 'fulfilled').length,
      failures: checks.filter(item => item.status === 'rejected').length,
      deliveries,
      duration_ms: Date.now() - started,
      at: now,
    };
    await setRuntimeValue(env.DB, 'last_cycle', JSON.stringify(summary), now);
    console.log(JSON.stringify({ event: 'cycle_finished', ...summary }));
    return summary;
  } catch (error) {
    const failure = {
      skipped: false,
      error: error instanceof Error ? error.message : String(error),
      duration_ms: Date.now() - started,
      at: now,
    };
    await setRuntimeValue(env.DB, 'last_cycle', JSON.stringify(failure), now).catch(() => {});
    console.error(JSON.stringify({ event: 'cycle_failed', ...failure }));
    throw error;
  } finally {
    await releaseLease(env.DB, owner);
  }
}

function isAuthorized(request, env) {
  const expected = `Bearer ${env.ADMIN_TOKEN || ''}`;
  return env.ADMIN_TOKEN && request.headers.get('authorization') === expected;
}

async function readJson(request) {
  try { return await request.json(); }
  catch { throw new Error('Request body must be valid JSON'); }
}

async function handleAuthorized(request, env, url, ctx) {
  if (request.method === 'GET' && url.pathname === '/api/creators') {
    const rows = await env.DB.prepare(`
      SELECT c.sec_uid, c.label, c.enabled, s.last_stable_status AS status,
             s.nickname, s.room_id, s.live_url, s.last_checked_at, s.error
      FROM creators c LEFT JOIN creator_states s ON s.sec_uid = c.sec_uid
      ORDER BY c.created_at ASC
    `).all();
    return json({ creators: rows.results || [] });
  }

  if (request.method === 'POST' && url.pathname === '/api/creators') {
    const body = await readJson(request);
    const secUid = normalizeSecUid(body.url || body.sec_uid || body.secUid);
    const label = String(body.label || '').trim().slice(0, 80);
    const now = new Date().toISOString();
    await env.DB.prepare(`
      INSERT INTO creators(sec_uid, label, enabled, created_at, updated_at)
      VALUES (?1, ?2, 1, ?3, ?3)
      ON CONFLICT(sec_uid) DO UPDATE SET label = excluded.label, enabled = 1, updated_at = excluded.updated_at
    `).bind(secUid, label, now).run();
    return json({ ok: true, sec_uid: secUid, label }, 201);
  }

  if (request.method === 'DELETE' && url.pathname.startsWith('/api/creators/')) {
    const secUid = decodeURIComponent(url.pathname.slice('/api/creators/'.length));
    const result = await env.DB.prepare('UPDATE creators SET enabled = 0, updated_at = ?1 WHERE sec_uid = ?2')
      .bind(new Date().toISOString(), secUid).run();
    return json({ ok: true, changed: Number(result.meta?.changes || 0) });
  }

  if (request.method === 'POST' && url.pathname === '/api/run') {
    ctx.waitUntil(runCycle(env));
    return json({ accepted: true }, 202);
  }

  return json({ error: 'not_found' }, 404);
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/health') {
      const [counts, lastCycleValue] = await Promise.all([
        env.DB.prepare(`
          SELECT
            (SELECT COUNT(*) FROM creators WHERE enabled = 1) AS active_creators,
            (SELECT COUNT(*) FROM deliveries WHERE status IN ('pending', 'retry')) AS pending_deliveries
        `).first(),
        getRuntimeValue(env.DB, 'last_cycle'),
      ]);
      let last_cycle = null;
      try { last_cycle = lastCycleValue ? JSON.parse(lastCycleValue) : null; } catch {}
      return json({ status: 'ok', channel: 'feishu_app', ...counts, ...(last_cycle ? { last_cycle } : {}) });
    }
    if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
    if (!isAuthorized(request, env)) return json({ error: 'unauthorized' }, 401);
    try {
      return await handleAuthorized(request, env, url, ctx);
    } catch (error) {
      console.error(JSON.stringify({ event: 'request_failed', path: url.pathname, error: error.message }));
      return json({ error: error.message }, 400);
    }
  },

  async scheduled(_controller, env, ctx) {
    ctx.waitUntil(runCycle(env));
  },
};
