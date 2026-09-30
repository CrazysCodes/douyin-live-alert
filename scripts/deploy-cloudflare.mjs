import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const app = resolve(root, 'apps/feishu-worker');
const templateConfigPath = resolve(app, 'wrangler.jsonc');
const localConfigPath = resolve(app, 'wrangler.local.jsonc');
const required = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_RECEIVE_ID', 'ADMIN_TOKEN'];

for (const name of required) {
  if (!process.env[name]) {
    console.error(`Missing ${name}. Read config.schema.json and export it in the current shell.`);
    process.exit(2);
  }
}
if (process.env.ADMIN_TOKEN.length < 24) {
  console.error('ADMIN_TOKEN must contain at least 24 characters.');
  process.exit(2);
}
function wrangler(args, options = {}) {
  const executable = process.execPath;
  const cli = resolve(root, 'node_modules/wrangler/bin/wrangler.js');
  const result = spawnSync(executable, [cli, ...args], {
    cwd: app,
    env: process.env,
    input: options.input,
    encoding: 'utf8',
    stdio: options.capture ? ['pipe', 'pipe', 'pipe'] : ['pipe', 'inherit', 'inherit'],
  });
  if (result.status !== 0) {
    if (options.capture) process.stderr.write(result.stderr || result.stdout || '');
    throw new Error(`wrangler ${args.join(' ')} failed${result.error ? `: ${result.error.message}` : ` with exit code ${result.status}`}`);
  }
  return result.stdout || '';
}

console.log('1/5 Checking Cloudflare authentication...');
wrangler(['whoami']);

let config = readFileSync(existsSync(localConfigPath) ? localConfigPath : templateConfigPath, 'utf8');
if (config.includes('REPLACE_WITH_D1_DATABASE_ID')) {
  console.log('2/5 Finding or creating the D1 database...');
  const databases = JSON.parse(wrangler(['d1', 'list', '--json'], { capture: true }));
  let databaseId = databases.find(database => database.name === 'douyin-live-alert')?.uuid;
  let output = '';
  if (!databaseId) {
    output = wrangler(['d1', 'create', 'douyin-live-alert', '--location', 'apac'], { capture: true });
    databaseId = output.match(/[0-9a-f]{8}-[0-9a-f-]{27,}/i)?.[0];
  }
  if (!databaseId) throw new Error(`Could not read the D1 database id from Wrangler output: ${output}`);
  config = config.replace('REPLACE_WITH_D1_DATABASE_ID', databaseId);
  writeFileSync(localConfigPath, config);
  console.log(`Recorded D1 database ${databaseId} in ignored wrangler.local.jsonc.`);
} else {
  if (!existsSync(localConfigPath)) writeFileSync(localConfigPath, config);
  console.log('2/5 Reusing the D1 database recorded in ignored wrangler.local.jsonc.');
}

console.log('3/5 Applying idempotent D1 migrations...');
wrangler(['d1', 'migrations', 'apply', 'douyin-live-alert', '--remote', '--config', localConfigPath]);

console.log('4/5 Uploading Worker secrets...');
wrangler(['secret', 'put', 'FEISHU_APP_ID', '--config', localConfigPath], { input: `${process.env.FEISHU_APP_ID}\n` });
wrangler(['secret', 'put', 'FEISHU_APP_SECRET', '--config', localConfigPath], { input: `${process.env.FEISHU_APP_SECRET}\n` });
wrangler(['secret', 'put', 'FEISHU_RECEIVE_ID', '--config', localConfigPath], { input: `${process.env.FEISHU_RECEIVE_ID}\n` });
wrangler(['secret', 'put', 'ADMIN_TOKEN', '--config', localConfigPath], { input: `${process.env.ADMIN_TOKEN}\n` });

console.log('5/5 Deploying Worker and one-minute cron trigger...');
wrangler(['deploy', '--config', localConfigPath]);
console.log('\nDeployment completed. Open the Worker URL followed by /health, then seed creators:');
console.log('  $env:WORKER_URL="https://<your-worker>.workers.dev"');
console.log('  npm run seed:cloudflare -- config/subscriptions.json');
console.log('This deployment script never sends a test notification.');
