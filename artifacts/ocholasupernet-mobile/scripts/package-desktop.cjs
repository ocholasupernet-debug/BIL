const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const projectRoot = path.resolve(__dirname, '..');
const stagingRoot = path.join(projectRoot, '.desktop-package');
const outputRoot = path.join(projectRoot, 'desktop-releases');
const pnpmCommand = process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm';
const mode = process.argv[2] || '';

function run(command, args, cwd = projectRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: {
      ...process.env,
      EXPO_PUBLIC_API_BASE_URL:
        process.env.EXPO_PUBLIC_API_BASE_URL || 'https://isplatty.org',
      CSC_IDENTITY_AUTO_DISCOVERY: process.env.CSC_IDENTITY_AUTO_DISCOVERY || 'false',
    },
    stdio: 'inherit',
  });

  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

function copy(source, destination) {
  fs.cpSync(source, destination, { recursive: true });
}

function prepareStaging() {
  const appConfig = JSON.parse(
    fs.readFileSync(path.join(projectRoot, 'app.json'), 'utf8'),
  );

  fs.rmSync(stagingRoot, { recursive: true, force: true });
  fs.rmSync(outputRoot, { recursive: true, force: true });
  fs.mkdirSync(stagingRoot, { recursive: true });

  copy(path.join(projectRoot, 'dist', 'desktop'), path.join(stagingRoot, 'dist', 'desktop'));
  copy(path.join(projectRoot, 'electron'), path.join(stagingRoot, 'electron'));
  copy(path.join(projectRoot, 'assets', 'images'), path.join(stagingRoot, 'assets', 'images'));
  copy(
    path.join(projectRoot, 'electron-builder.yml'),
    path.join(stagingRoot, 'electron-builder.yml'),
  );

  fs.writeFileSync(
    path.join(stagingRoot, 'package.json'),
    `${JSON.stringify(
      {
        name: 'ocholasupernet-desktop',
        version: appConfig.expo?.version || '1.0.0',
        description: 'OcholaSuperNet desktop companion for ISP administrators',
        author: 'OcholaSuperNet',
        main: 'electron/main.cjs',
        private: true,
      },
      null,
      2,
    )}\n`,
  );
}

function builderArgs() {
  const args = ['exec', 'electron-builder', '--projectDir', stagingRoot, '--config', 'electron-builder.yml'];
  if (mode === '--windows') return [...args, '--win', 'nsis', 'portable'];
  if (mode === '--macos') return [...args, '--mac', 'dmg', 'zip'];
  if (mode === '--dir') return [...args, '--dir', '--linux', 'dir'];
  return args;
}

function publishOutput() {
  const stagedOutput = path.join(stagingRoot, 'release');
  if (!fs.existsSync(stagedOutput)) {
    throw new Error(`Electron Builder did not create ${stagedOutput}`);
  }
  copy(stagedOutput, outputRoot);
  fs.rmSync(stagingRoot, { recursive: true, force: true });
}

try {
  run(pnpmCommand, ['run', 'build:desktop']);
  prepareStaging();
  run(pnpmCommand, builderArgs());
  publishOutput();
  console.log(`Desktop package ready in ${path.relative(projectRoot, outputRoot)}/`);
} catch (error) {
  console.error(`Desktop packaging failed: ${error.message}`);
  process.exit(1);
}