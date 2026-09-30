import { registerApp } from '@larksuiteoapi/node-sdk';

function parseAppId(argv) {
  const index = argv.indexOf('--app-id');
  return (index >= 0 ? argv[index + 1] : process.env.FEISHU_APP_ID || '').trim();
}

const appId = parseAppId(process.argv.slice(2));
if (!/^cli_[A-Za-z0-9]+$/.test(appId)) {
  console.error('Missing or invalid Feishu App ID.');
  console.error('Run: npm run setup:feishu -- --app-id cli_xxx');
  process.exit(2);
}

console.log('Preparing Feishu authorization for the existing app.');
console.log('The script requests only bot message sending permission and never prints the App Secret.');

try {
  const result = await registerApp({
    appId,
    source: 'douyin-live-alert',
    appPreset: {
      name: '抖抖先知',
      desc: '订阅抖音主播，在开播时通过飞书机器人提醒。',
    },
    addons: {
      preset: false,
      scopes: { tenant: ['im:message:send_as_bot'] },
    },
    onQRCodeReady(info) {
      console.log('\n请在飞书中打开下面的授权链接并确认：');
      console.log(info.url);
      console.log(`链接约 ${info.expireIn} 秒后过期，脚本正在等待授权……\n`);
    },
    onStatusChange(info) {
      if (info.status === 'domain_switched') console.log('已切换到适合当前账号的飞书认证域名。');
      if (info.status === 'slow_down') console.log('飞书要求降低查询频率，脚本会自动继续等待。');
    },
  });

  const openId = result.user_info?.open_id || '';
  if (!openId) throw new Error('Authorization succeeded but Feishu did not return user_info.open_id');
  if (result.client_id && result.client_id !== appId) {
    throw new Error(`Feishu returned a different App ID: ${result.client_id}`);
  }

  console.log('飞书授权成功。请把下面两项用于部署：');
  console.log('FEISHU_RECEIVE_ID_TYPE=open_id');
  console.log(`FEISHU_RECEIVE_ID=${openId}`);
  console.log('App Secret 已由飞书返回但不会显示；部署时继续使用你现有的 App Secret。');
} catch (error) {
  const code = error?.code ? `${error.code}: ` : '';
  console.error(`飞书授权失败：${code}${error?.description || error?.message || String(error)}`);
  process.exitCode = 1;
}
