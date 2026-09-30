import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const requiredFiles = [
  'AGENTS.md',
  'README.md',
  'LICENSE',
  'SECURITY.md',
  'CONTRIBUTING.md',
  'config.schema.json',
  'deploy.manifest.json',
  'docs/ai-deploy.md',
  'apps/feishu-worker/wrangler.jsonc',
  'apps/feishu-worker/migrations/0001_init.sql',
];

const checks = [];
const nodeMajor = Number(process.versions.node.split('.')[0]);
checks.push({ name: 'Node.js >= 22', ok: nodeMajor >= 22, detail: process.versions.node });
for (const file of requiredFiles) {
  checks.push({ name: file, ok: existsSync(resolve(root, file)), detail: existsSync(resolve(root, file)) ? 'present' : 'missing' });
}

try {
  JSON.parse(readFileSync(resolve(root, 'config.schema.json'), 'utf8'));
  JSON.parse(readFileSync(resolve(root, 'deploy.manifest.json'), 'utf8'));
  checks.push({ name: 'machine-readable manifests', ok: true, detail: 'valid JSON' });
} catch (error) {
  checks.push({ name: 'machine-readable manifests', ok: false, detail: error.message });
}

checks.push({
  name: 'Wrangler installed',
  ok: existsSync(resolve(root, 'node_modules/wrangler/bin/wrangler.js')),
  detail: existsSync(resolve(root, 'node_modules/wrangler/bin/wrangler.js')) ? 'present' : 'run npm install',
});

const wranglerTemplate = readFileSync(resolve(root, 'apps/feishu-worker/wrangler.jsonc'), 'utf8');
checks.push({
  name: 'public Wrangler config contains no deployment-specific D1 id',
  ok: wranglerTemplate.includes('REPLACE_WITH_D1_DATABASE_ID'),
  detail: wranglerTemplate.includes('REPLACE_WITH_D1_DATABASE_ID') ? 'template placeholder present' : 'restore the placeholder before publishing',
});
const gitignore = readFileSync(resolve(root, '.gitignore'), 'utf8');
checks.push({
  name: 'local Wrangler config is ignored',
  ok: gitignore.split(/\r?\n/).includes('wrangler.local.jsonc'),
  detail: gitignore.split(/\r?\n/).includes('wrangler.local.jsonc') ? 'ignored' : 'missing ignore rule',
});

for (const check of checks) console.log(`${check.ok ? '✓' : '✗'} ${check.name}: ${check.detail}`);
const missingSecrets = ['CLOUDFLARE_API_TOKEN', 'CLOUDFLARE_ACCOUNT_ID', 'FEISHU_APP_ID', 'FEISHU_APP_SECRET', 'FEISHU_RECEIVE_ID', 'ADMIN_TOKEN']
  .filter(name => !process.env[name]);
console.log(missingSecrets.length
  ? `ℹ Deployment secrets not present in this shell: ${missingSecrets.join(', ')}`
  : '✓ Deployment inputs are present in the current shell.');

if (checks.some(check => !check.ok && check.name !== 'Wrangler installed')) process.exitCode = 1;
