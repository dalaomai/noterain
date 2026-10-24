import { spawnSync } from 'node:child_process';

const registry = process.env.NOTERAIN_NPM_REGISTRY || 'https://registry.npmjs.org/';
const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
console.log(`[install] npm registry: ${registry}`);
const result = spawnSync(
  npm,
  ['ci', '--registry', registry, '--replace-registry-host=always', ...process.argv.slice(2)],
  { stdio: 'inherit', env: process.env },
);
if (result.error) throw result.error;
process.exit(result.status ?? 1);
