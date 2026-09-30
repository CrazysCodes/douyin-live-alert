const DEFAULT_USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36';

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function firstValue(...values) {
  return values.find(value => value !== undefined && value !== null && value !== '');
}

function cleanId(value) {
  const text = String(value ?? '').trim();
  return text && text !== '0' ? text : '';
}

function explicitLiveFlag(value) {
  if (value === true || value === 1 || value === '1' || value === 'live' || value === 'living') return true;
  if (value === false || value === 0 || value === '0' || value === 'offline' || value === 'ended') return false;
  return null;
}

function roomLiveFlag(value) {
  if (value === 2 || value === '2') return true;
  if (value === 4 || value === '4') return false;
  return explicitLiveFlag(value);
}

function numericValue(value) {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'string') return 0;
  const match = value.replace(/,/g, '').trim().match(/^(\d+(?:\.\d+)?)\s*([万亿])?$/);
  if (!match) return 0;
  const multiplier = match[2] === '万' ? 10_000 : match[2] === '亿' ? 100_000_000 : 1;
  return Math.round(Number(match[1]) * multiplier);
}

function findNestedRoom(root, depth = 0, seen = new Set()) {
  if (!root || typeof root !== 'object' || depth > 5 || seen.has(root)) return null;
  seen.add(root);
  const direct = [root.room, root.live_room, root.liveRoom].map(asObject).find(Boolean);
  if (direct) return direct;
  for (const value of Object.values(root)) {
    const object = asObject(value);
    if (!object) continue;
    if ((object.id || object.room_id || object.roomId) && (object.title || object.owner || object.status != null)) return object;
    const nested = findNestedRoom(object, depth + 1, seen);
    if (nested) return nested;
  }
  return null;
}

export function normalizeSecUid(input) {
  const value = String(input ?? '').trim();
  if (!value) throw new Error('Douyin creator must not be empty');
  if (!/^https?:\/\//i.test(value)) {
    if (/\s|\//.test(value)) throw new Error(`Invalid Douyin sec_uid: ${value}`);
    return value;
  }
  const url = new URL(value);
  if (!/(^|\.)douyin\.com$/i.test(url.hostname)) throw new Error(`Expected a douyin.com URL: ${value}`);
  const match = url.pathname.match(/^\/user\/([^/?#]+)/);
  if (!match) throw new Error(`Douyin URL must contain /user/<sec_uid>: ${value}`);
  return decodeURIComponent(match[1]);
}

export function normalizeLiveProfile(payload, secUid, checkedAt = new Date()) {
  const user = asObject(payload?.user)
    ?? asObject(payload?.user_info)
    ?? asObject(payload?.data?.user)
    ?? asObject(payload?.data?.user_info);
  if (!user) throw new Error(`Douyin profile response is missing user data for ${secUid}`);
  const roomData = asObject(user.room_data ?? user.roomData);
  const room = findNestedRoom(roomData) ?? findNestedRoom(user) ?? asObject(payload?.room) ?? {};
  const roomId = cleanId(firstValue(room.id, room.room_id, room.roomId, user.room_id, user.roomId));
  const userFlag = explicitLiveFlag(firstValue(user.live_status, user.liveStatus, user.is_living, user.isLiving));
  const roomFlag = roomLiveFlag(firstValue(room.status, room.live_status, room.liveStatus));
  const isLive = userFlag ?? roomFlag ?? Boolean(roomId);
  return {
    sec_uid: secUid,
    nickname: String(firstValue(user.nickname, user.nick_name, user.name) ?? ''),
    status: isLive ? 'live' : 'offline',
    is_live: isLive,
    room_id: isLive ? roomId : '',
    title: isLive ? String(firstValue(room.title, room.room_title, user.live_title) ?? '') : '',
    viewer_count: isLive ? numericValue(firstValue(room.user_count, room.userCount, room.stats?.user_count)) : 0,
    live_url: isLive && roomId ? `https://live.douyin.com/${roomId}` : `https://www.douyin.com/user/${secUid}`,
    checked_at: checkedAt.toISOString(),
  };
}

export function classifyLiveTransition(previous, current) {
  if (!previous?.initialized_at) return 'baseline_initialized';
  if (!current.is_live) return 'status_checked';
  if (previous.last_stable_status !== 'live') return 'live_started';
  if (previous.room_id && current.room_id && previous.room_id !== current.room_id) return 'live_started';
  return 'status_checked';
}

export function nextLiveState(previous, current, checkedAt = current.checked_at) {
  const event = classifyLiveTransition(previous, current);
  return {
    initialized_at: previous?.initialized_at || checkedAt,
    last_stable_status: current.status,
    room_id: current.is_live ? current.room_id : '',
    nickname: current.nickname || previous?.nickname || '',
    title: current.is_live ? current.title : '',
    live_url: current.live_url,
    last_checked_at: checkedAt,
    last_live_started_at: event === 'live_started' ? checkedAt : previous?.last_live_started_at || '',
    error: '',
  };
}

export function liveEventKey(snapshot) {
  const discriminator = snapshot.room_id || snapshot.checked_at.slice(0, 16);
  return `live:${snapshot.sec_uid}:${discriminator}`;
}

export function buildLiveAlert(snapshot, label = '') {
  const name = snapshot.nickname || label || '订阅主播';
  const title = snapshot.title || '正在直播';
  const viewers = snapshot.viewer_count > 0 ? `\n在线人数：${snapshot.viewer_count}` : '';
  return {
    title: `🔴 ${name} 开播了`,
    text: `🔴 ${name} 开播了\n${title}${viewers}\n${snapshot.live_url}`,
    url: snapshot.live_url,
    nickname: name,
    live_title: title,
    viewer_count: snapshot.viewer_count || 0,
  };
}

export class FeishuAppClient {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.appId = options.appId || '';
    this.appSecret = options.appSecret || '';
    this.receiveId = options.receiveId || '';
    this.receiveIdType = options.receiveIdType || 'open_id';
    this.now = options.now ?? (() => Date.now());
    this.token = '';
    this.tokenExpiresAt = 0;
    this.tokenPromise = null;
  }

  async getTenantToken() {
    if (this.token && this.tokenExpiresAt > this.now() + 5 * 60_000) return this.token;
    if (this.tokenPromise) return this.tokenPromise;
    this.tokenPromise = this.requestTenantToken().finally(() => { this.tokenPromise = null; });
    return this.tokenPromise;
  }

  async requestTenantToken() {
    const response = await this.fetch('https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal', {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ app_id: this.appId, app_secret: this.appSecret }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || Number(result.code || 0) !== 0 || !result.tenant_access_token) {
      throw new Error(`Feishu token failed: HTTP ${response.status}, code ${result.code ?? 'unknown'}, ${result.msg ?? ''}`);
    }
    this.token = result.tenant_access_token;
    this.tokenExpiresAt = this.now() + Number(result.expire || 7200) * 1000;
    return this.token;
  }

  async sendText(text) {
    if (!this.appId || !this.appSecret || !this.receiveId) throw new Error('Feishu app credentials and receiver are required');
    const token = await this.getTenantToken();
    const url = new URL('https://open.feishu.cn/open-apis/im/v1/messages');
    url.searchParams.set('receive_id_type', this.receiveIdType);
    const response = await this.fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json; charset=utf-8',
      },
      body: JSON.stringify({
        receive_id: this.receiveId,
        msg_type: 'text',
        content: JSON.stringify({ text }),
      }),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok || Number(result.code || 0) !== 0) {
      throw new Error(`Feishu message failed: HTTP ${response.status}, code ${result.code ?? 'unknown'}, ${result.msg ?? ''}`);
    }
    return result;
  }
}

export class DouyinHttpClient {
  constructor(options = {}) {
    this.fetch = options.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = Math.max(1_000, Number(options.timeoutMs || 10_000));
    this.userAgent = options.userAgent || DEFAULT_USER_AGENT;
    this.ttwid = options.ttwid || '';
    this.ttwidPromise = null;
  }

  async withTimeout(url, options = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetch(url, { ...options, signal: controller.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async registerTtwid() {
    const response = await this.withTimeout('https://ttwid.bytedance.com/ttwid/union/register/', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'user-agent': this.userAgent },
      body: JSON.stringify({
        region: 'cn', aid: 6383, needFid: false, service: 'www.douyin.com',
        migrate_info: { ticket: '', source: 'cloudflare-worker' }, cbUrlProtocol: 'https', union: true,
      }),
    });
    if (!response.ok) throw new Error(`ttwid registration returned HTTP ${response.status}`);
    const cookie = response.headers.get('set-cookie') || '';
    const match = cookie.match(/(?:^|,\s*)ttwid=([^;]+)/i);
    if (!match) throw new Error('ttwid registration did not return a cookie');
    this.ttwid = match[1];
    return this.ttwid;
  }

  getTtwid() {
    if (this.ttwid) return Promise.resolve(this.ttwid);
    if (this.ttwidPromise) return this.ttwidPromise;
    this.ttwidPromise = this.registerTtwid().finally(() => { this.ttwidPromise = null; });
    return this.ttwidPromise;
  }

  invalidateTtwid(value) {
    if (this.ttwid === value) this.ttwid = '';
  }

  async requestProfile(secUid, ttwid) {
    const path = `/aweme/v1/web/user/profile/other/?sec_user_id=${encodeURIComponent(secUid)}&aid=6383`;
    const response = await this.withTimeout(`https://www.douyin.com${path}`, {
      headers: {
        'user-agent': this.userAgent,
        accept: 'application/json, text/plain, */*',
        'accept-language': 'zh-CN,zh;q=0.9',
        referer: `https://www.douyin.com/user/${encodeURIComponent(secUid)}`,
        cookie: `ttwid=${ttwid}`,
      },
    });
    const text = await response.text();
    if (!response.ok || !text) throw new Error(`Douyin profile returned HTTP ${response.status} with ${text.length} bytes`);
    const payload = JSON.parse(text);
    if (payload?.status_code != null && payload.status_code !== 0) throw new Error(`Douyin API error ${payload.status_code}`);
    return payload;
  }

  async fetchProfile(secUid) {
    const first = await this.getTtwid();
    try {
      return await this.requestProfile(secUid, first);
    } catch (firstError) {
      this.invalidateTtwid(first);
      const refreshed = await this.getTtwid();
      try {
        return await this.requestProfile(secUid, refreshed);
      } catch (error) {
        error.cause = firstError;
        throw error;
      }
    }
  }
}
