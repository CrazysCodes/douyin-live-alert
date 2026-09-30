import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/index.js';

function environment() {
  return {
    ADMIN_TOKEN: 'a'.repeat(24),
    DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async first() {
            if (sql.includes('active_creators')) return { active_creators: 2, pending_deliveries: 0 };
            return null;
          },
          async all() { return { results: [] }; },
          async run() { return { meta: { changes: 1 } }; },
        };
      },
    },
  };
}

test('health is public and reports the Feishu app channel', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), environment(), {});
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), {
    status: 'ok', channel: 'feishu_app', active_creators: 2, pending_deliveries: 0,
  });
});

test('management APIs require the admin bearer token', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/creators'), environment(), {});
  assert.equal(response.status, 401);
});

test('management API accepts direct profile URLs', async () => {
  const response = await worker.fetch(new Request('https://example.test/api/creators', {
    method: 'POST',
    headers: { authorization: `Bearer ${'a'.repeat(24)}`, 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://www.douyin.com/user/test_uid', label: '测试' }),
  }), environment(), {});
  assert.equal(response.status, 201);
  assert.equal((await response.json()).sec_uid, 'test_uid');
});
