import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DouyinHttpClient,
  FeishuAppClient,
  buildLiveAlert,
  classifyLiveTransition,
  liveEventKey,
  nextLiveState,
  normalizeLiveProfile,
  normalizeSecUid,
} from '../src/index.js';

test('normalizes sec_uid and profile URLs', () => {
  assert.equal(normalizeSecUid('abc_123'), 'abc_123');
  assert.equal(normalizeSecUid('https://www.douyin.com/user/abc_123?from=web'), 'abc_123');
});

test('first observation establishes a baseline without a notification', () => {
  const snapshot = normalizeLiveProfile({ user: { nickname: '主播', live_status: 1, room_id: '42' } }, 'sec', new Date('2026-01-01T00:00:00Z'));
  assert.equal(classifyLiveTransition(null, snapshot), 'baseline_initialized');
  const state = nextLiveState(null, snapshot);
  assert.equal(state.last_stable_status, 'live');
  assert.equal(state.initialized_at, '2026-01-01T00:00:00.000Z');
});

test('offline to live and room changes emit live_started', () => {
  const current = { is_live: true, room_id: '2' };
  assert.equal(classifyLiveTransition({ initialized_at: 'x', last_stable_status: 'offline', room_id: '' }, current), 'live_started');
  assert.equal(classifyLiveTransition({ initialized_at: 'x', last_stable_status: 'live', room_id: '1' }, current), 'live_started');
  assert.equal(classifyLiveTransition({ initialized_at: 'x', last_stable_status: 'live', room_id: '2' }, current), 'status_checked');
});

test('event keys are stable and alert payload contains the live link', () => {
  const snapshot = {
    sec_uid: 'sec', room_id: 'room', checked_at: '2026-01-01T00:00:00.000Z',
    nickname: '主播', title: '标题', live_url: 'https://live.douyin.com/room', viewer_count: 10,
  };
  assert.equal(liveEventKey(snapshot), 'live:sec:room');
  const message = buildLiveAlert(snapshot);
  assert.equal(message.nickname, '主播');
  assert.match(message.text, /主播/);
  assert.match(message.text, /https:\/\/live\.douyin\.com\/room/);
});

test('Feishu app client caches a tenant token and defaults to an open_id receiver', async () => {
  const requests = [];
  const fetch = async (url, options) => {
    requests.push({ url: String(url), options });
    if (String(url).includes('tenant_access_token')) {
      return Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 });
    }
    return Response.json({ code: 0, msg: 'ok', data: { message_id: 'm1' } });
  };
  const client = new FeishuAppClient({
    fetch, appId: 'cli_test', appSecret: 'secret', receiveId: 'ou_test_user', now: () => 1,
  });
  await Promise.all([client.sendText('开播了'), client.sendText('又开播了')]);
  assert.equal(requests.filter(item => item.url.includes('tenant_access_token')).length, 1);
  assert.match(requests[1].url, /receive_id_type=open_id/);
  const body = JSON.parse(requests[1].options.body);
  assert.equal(body.receive_id, 'ou_test_user');
  assert.equal(JSON.parse(body.content).text, '开播了');
});

test('concurrent failures share a single ttwid refresh', async () => {
  let registrations = 0;
  const fetch = async (url, options = {}) => {
    if (String(url).includes('ttwid/union/register')) {
      registrations += 1;
      await new Promise(resolve => setTimeout(resolve, 5));
      return new Response('{}', { status: 200, headers: { 'set-cookie': 'ttwid=fresh; Path=/' } });
    }
    if (options.headers.cookie === 'ttwid=old') return new Response('', { status: 403 });
    return Response.json({ user: { nickname: 'ok', live_status: 0 } });
  };
  const client = new DouyinHttpClient({ fetch, ttwid: 'old' });
  await Promise.all([client.fetchProfile('a'), client.fetchProfile('b')]);
  assert.equal(registrations, 1);
});

test('clients bind the platform fetch implementation', () => {
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'fetch');
  const platform = { calls: 0 };
  Object.defineProperty(globalThis, 'fetch', {
    configurable: true,
    value() {
      assert.equal(this, globalThis);
      platform.calls += 1;
      return Promise.resolve(Response.json({ code: 0, tenant_access_token: 'token', expire: 7200 }));
    },
  });
  try {
    const client = new FeishuAppClient({ appId: 'cli_test', appSecret: 'secret', receiveId: 'ou_test' });
    return client.getTenantToken().then(() => assert.equal(platform.calls, 1));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, 'fetch', descriptor);
  }
});
