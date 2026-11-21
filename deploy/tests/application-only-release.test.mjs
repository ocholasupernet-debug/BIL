import assert from "node:assert/strict";
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = fileURLToPath(new URL("../../", import.meta.url));
const source = (relativePath) =>
  readFile(path.join(repoRoot, relativePath), "utf8");

const executable = async (filePath, contents) => {
  await writeFile(filePath, contents);
  await chmod(filePath, 0o755);
};

test("manual application-only workflow does not forward runtime secrets to SSH", async () => {
  const workflow = await source(".github/workflows/deploy.yml");
  assert.match(
    workflow,
    /application_only_release:\n\s+description: "Deploy app code while preserving VPS \.env and skipping database, Nginx, and router changes"\n\s+required: false\n\s+default: false\n\s+type: boolean/,
  );
  const sshStart = workflow.indexOf("- name: Deploy via SSH");
  const sshEnd = workflow.indexOf("\n      - name:", sshStart + 1);
  const sshStep = workflow.slice(sshStart, sshEnd);
  const forwarded = sshStep.match(
    /envs:\s*\$\{\{\s*inputs\.application_only_release\s*&&\s*'([^']+)'\s*\|\|/,
  )?.[1];
  assert.deepEqual(forwarded?.split(","), [
    "APP_ONLY_RELEASE",
    "DEPLOY_SKIP_ROUTER_MANAGEMENT_SETUP",
    "DEPLOY_SKIP_ROUTER_ONESHOTS",
  ]);
  assert.match(
    sshStep,
    /APP_ONLY_RELEASE: \$\{\{ inputs\.application_only_release \}\}/,
  );
  assert.match(
    sshStep,
    /DEPLOY_SKIP_ROUTER_MANAGEMENT_SETUP: \$\{\{ github\.event_name == 'push' \|\| inputs\.skip_router_management_setup \|\| inputs\.application_only_release \}\}/,
  );
  assert.match(
    sshStep,
    /DEPLOY_SKIP_ROUTER_ONESHOTS: \$\{\{ github\.event_name == 'push' \|\| inputs\.skip_router_oneshots \|\| inputs\.application_only_release \}\}/,
  );
  assert.match(
    workflow,
    /- name: Require app-only mode on scoped migration release branches\n\s+if: startsWith\(github\.ref, 'refs\/heads\/deploy\/supabase-migration-app-only-'\)\n\s+env:\n\s+APP_ONLY_RELEASE: \$\{\{ inputs\.application_only_release \}\}/,
  );
});

test("application-only workflow skips VPS config writes, Nginx, database, and router steps", async () => {
  const workflow = await source(".github/workflows/deploy.yml");
  assert.match(workflow, /--exclude='\.\/data\/backups'/);
  assert.match(
    workflow,
    /- name: Verify app-only build still targets BIL source\n\s+if: inputs\.application_only_release\n\s+env:\n\s+VITE_SUPABASE_URL: \$\{\{ secrets\.VITE_SUPABASE_URL \}\}\n\s+run: node deploy\/verify-supabase-build-target\.mjs/,
  );
  assert.doesNotMatch(workflow, /deploy\/validate-r2-env\.mjs/);
  assert.match(
    workflow,
    /if \[ "\$\{APP_ONLY_RELEASE:-false\}" = "true" \]; then\n\s+echo "Application-only release: skipping VPS \.env writes, WhatsApp sync, and Nginx configuration\."\n\s+else[\s\S]*?upsert_env "SUPABASE_DB_URL"[\s\S]*?node deploy\/sync-whatsapp-env\.mjs[\s\S]*?bash deploy\/configure-nginx\.sh\n\s+fi/,
  );
  assert.match(workflow, /DEPLOY_APP_ONLY="\$\{APP_ONLY_RELEASE:-false\}"/);

  const appExit = workflow.indexOf(
    'echo "=== Application-only release finished; router actions were not run ==="',
  );
  const routerActions = workflow.indexOf(
    'if [ -n "${SYNC_ROUTER_CONFIGURATION_IDS:-}" ]',
  );
  assert.ok(appExit >= 0 && routerActions > appExit);

  const deploy = await source("deploy/deploy.sh");
  const appOnlyGuard = deploy.indexOf('case "${DEPLOY_APP_ONLY:-false}" in');
  const databaseMigration = deploy.indexOf("apply_supabase_migration() {");
  assert.ok(appOnlyGuard >= 0 && databaseMigration > appOnlyGuard);
  assert.match(
    deploy.slice(appOnlyGuard, databaseMigration),
    /app-only-release\.sh[\s\S]*?exit 0/,
  );
});

test("app-only build target check accepts only the source project and never prints the URL", async (t) => {
  const script = path.join(repoRoot, "deploy/verify-supabase-build-target.mjs");
  const sentinel = "do-not-print-the-configured-url";
  const run = (url) =>
    spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: {
        PATH: process.env.PATH ?? "",
        VITE_SUPABASE_URL: url,
      },
    });

  const valid = run("https://qfsxsbzaqwmyuxhramyw.supabase.co");
  assert.equal(valid.status, 0, valid.stderr);

  const wrongProject = run(
    `https://vuvyweofsutgqdtbjckj.supabase.co/${sentinel}`,
  );
  assert.notEqual(wrongProject.status, 0);
  assert.doesNotMatch(
    wrongProject.stdout + wrongProject.stderr,
    /supabase\.co|do-not-print/,
  );

  const invalidUrl = run(sentinel);
  assert.notEqual(invalidUrl.status, 0);
  assert.doesNotMatch(
    invalidUrl.stdout + invalidUrl.stderr,
    new RegExp(sentinel),
  );

  const missing = spawnSync(process.execPath, [script], {
    encoding: "utf8",
    env: { PATH: process.env.PATH ?? "" },
  });
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /URL is missing/);
});

test("app-only release preserves the existing .env and skips infrastructure commands", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "bil-app-only-release-"),
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const project = path.join(tempRoot, "project");
  const mockBin = path.join(tempRoot, "bin");
  const publicRoot = path.join(tempRoot, "web-root");
  const logFile = path.join(tempRoot, "commands.log");
  await mkdir(path.join(project, "deploy"), { recursive: true });
  await mkdir(path.join(project, "artifacts/ochola-supernet/dist/public"), {
    recursive: true,
  });
  await mkdir(path.join(project, "artifacts/api-server/dist"), {
    recursive: true,
  });
  await mkdir(mockBin, { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await writeFile(
    path.join(project, ".env"),
    "SUPABASE_DB_URL=preserve-this-runtime-value\nCLOUDFLARE_R2_SECRET_ACCESS_KEY=do-not-print\n",
  );
  await chmod(path.join(project, ".env"), 0o640);
  await writeFile(
    path.join(project, "artifacts/ochola-supernet/dist/public/index.html"),
    "<main>release preview</main>",
  );
  await writeFile(
    path.join(project, "artifacts/api-server/dist/index.mjs"),
    "/* built api */",
  );
  await writeFile(
    path.join(project, "ecosystem.config.cjs"),
    "module.exports = {};\n",
  );
  await writeFile(logFile, "");

  await executable(
    path.join(mockBin, "pm2"),
    '#!/usr/bin/env bash\nprintf "pm2 %s\\n" "$*" >> "$MOCK_COMMAND_LOG"\nif [ "$1" = "describe" ] && [ "$2" = "ocholanet-api" ]; then exit 0; fi\n',
  );
  await executable(
    path.join(mockBin, "curl"),
    '#!/usr/bin/env bash\nprintf "curl %s\\n" "$*" >> "$MOCK_COMMAND_LOG"\nexit 0\n',
  );
  await executable(
    path.join(mockBin, "rsync"),
    '#!/usr/bin/env bash\nargs=("$@")\nsource_path="${args[${#args[@]}-2]}"\ntarget_path="${args[${#args[@]}-1]}"\nprintf "rsync %s %s\\n" "$source_path" "$target_path" >> "$MOCK_COMMAND_LOG"\nmkdir -p "$target_path"\nfind "$target_path" -mindepth 1 -maxdepth 1 -exec rm -rf {} +\ncp -a "${source_path%/}/." "$target_path/"\n',
  );

  const envBefore = await readFile(path.join(project, ".env"), "utf8");
  const modeBefore = (await stat(path.join(project, ".env"))).mode & 0o777;
  const result = spawnSync(
    "bash",
    [path.join(repoRoot, "deploy/app-only-release.sh")],
    {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH}`,
        PROJECT_DIR: project,
        PUBLIC_HTML: publicRoot,
        DEPLOY_FROM_ARCHIVE: "1",
        MOCK_COMMAND_LOG: logFile,
      },
    },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.doesNotMatch(
    result.stdout,
    /preserve-this-runtime-value|do-not-print/,
  );
  assert.equal(await readFile(path.join(project, ".env"), "utf8"), envBefore);
  assert.equal(
    (await stat(path.join(project, ".env"))).mode & 0o777,
    modeBefore,
  );
  assert.equal(
    await readFile(path.join(publicRoot, "index.html"), "utf8"),
    "<main>release preview</main>",
  );
  const calls = await readFile(logFile, "utf8");
  assert.match(calls, /pm2 reload ocholanet-api/);
  assert.match(calls, /curl .*http:\/\/127\.0\.0\.1:8080\/api\/healthz/);
  assert.match(calls, /rsync /);
  assert.doesNotMatch(calls, /nginx|systemctl|router|supabase|migration/i);
  assert.doesNotMatch(calls, /pm2 start|--update-env/);
  const releaseScript = await source("deploy/app-only-release.sh");
  assert.doesNotMatch(releaseScript, /source .*\.env|--update-env|pm2 start/);
});

test("app-only release refuses to start without an existing archive and VPS .env", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "bil-app-only-refusal-"),
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const project = path.join(tempRoot, "project");
  await mkdir(project, { recursive: true });
  const logFile = path.join(tempRoot, "commands.log");
  const result = spawnSync(
    "bash",
    [path.join(repoRoot, "deploy/app-only-release.sh")],
    {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        PROJECT_DIR: project,
        PUBLIC_HTML: tempRoot,
        DEPLOY_FROM_ARCHIVE: "0",
        MOCK_COMMAND_LOG: logFile,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires an archive/);
});

test("app-only release refuses a missing PM2 service before publishing files", async (t) => {
  const tempRoot = await mkdtemp(
    path.join(os.tmpdir(), "bil-app-only-no-pm2-"),
  );
  t.after(() => rm(tempRoot, { recursive: true, force: true }));

  const project = path.join(tempRoot, "project");
  const mockBin = path.join(tempRoot, "bin");
  const publicRoot = path.join(tempRoot, "web-root");
  const logFile = path.join(tempRoot, "commands.log");
  await mkdir(path.join(project, "artifacts/ochola-supernet/dist/public"), {
    recursive: true,
  });
  await mkdir(path.join(project, "artifacts/api-server/dist"), {
    recursive: true,
  });
  await mkdir(mockBin, { recursive: true });
  await mkdir(publicRoot, { recursive: true });
  await writeFile(
    path.join(project, ".env"),
    "SESSION_SECRET=existing-value\n",
  );
  await writeFile(
    path.join(project, "artifacts/ochola-supernet/dist/public/index.html"),
    "<main>new</main>",
  );
  await writeFile(
    path.join(project, "artifacts/api-server/dist/index.mjs"),
    "/* api */",
  );
  await writeFile(path.join(publicRoot, "index.html"), "<main>old</main>");
  await writeFile(logFile, "");
  await executable(
    path.join(mockBin, "pm2"),
    '#!/usr/bin/env bash\nprintf "pm2 %s\\n" "$*" >> "$MOCK_COMMAND_LOG"\nexit 1\n',
  );
  await executable(
    path.join(mockBin, "curl"),
    '#!/usr/bin/env bash\nprintf "curl %s\\n" "$*" >> "$MOCK_COMMAND_LOG"\nexit 0\n',
  );
  await executable(
    path.join(mockBin, "rsync"),
    '#!/usr/bin/env bash\nprintf "rsync %s\\n" "$*" >> "$MOCK_COMMAND_LOG"\nexit 0\n',
  );

  const result = spawnSync(
    "bash",
    [path.join(repoRoot, "deploy/app-only-release.sh")],
    {
      cwd: project,
      encoding: "utf8",
      env: {
        ...process.env,
        PATH: `${mockBin}:${process.env.PATH}`,
        PROJECT_DIR: project,
        PUBLIC_HTML: publicRoot,
        DEPLOY_FROM_ARCHIVE: "1",
        MOCK_COMMAND_LOG: logFile,
      },
    },
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /requires the existing PM2 process/);
  assert.equal(
    await readFile(path.join(publicRoot, "index.html"), "utf8"),
    "<main>old</main>",
  );
  const calls = await readFile(logFile, "utf8");
  assert.match(calls, /pm2 describe ocholanet-api/);
  assert.doesNotMatch(calls, /pm2 reload|curl |rsync /);
});
