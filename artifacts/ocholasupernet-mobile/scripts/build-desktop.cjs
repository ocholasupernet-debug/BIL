const { spawnSync } = require('child_process');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';

const env = {
  ...process.env,
  // Keep local builds useful without requiring a .env file. The value can
  // still be replaced by CI or a developer for a staging API.
  EXPO_PUBLIC_API_BASE_URL:
    process.env.EXPO_PUBLIC_API_BASE_URL || 'https://isplatty.org',
};

const result = spawnSync(
  pnpmCommand,
  ['exec', 'expo', 'export', '--platform', 'web', '--output-dir', 'dist/desktop', '--clear'],
  {
    cwd: projectRoot,
    env,
    stdio: 'inherit',
  },
);

if (result.error) {
  console.error(`Could not start the desktop export: ${result.error.message}`);
  process.exit(1);
}

process.exit(result.status ?? 1);