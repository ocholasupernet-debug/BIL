// Start ONLY this named process, as the new isplatty-org OS user.
module.exports = {
  apps: [{
    name: 'isplatty-org-corporate',
    cwd: '/var/www/isplatty-org/current',
    script: 'server/index.mjs',
    interpreter: 'node',
    node_args: '--env-file=/etc/isplatty-org/site.env',
    instances: 1,
    exec_mode: 'fork',
    max_memory_restart: '350M',
    kill_timeout: 10000,
    time: true,
    env: { NODE_ENV: 'production' },
    error_file: '/var/log/isplatty-org/error.log',
    out_file: '/var/log/isplatty-org/output.log',
    merge_logs: true,
  }],
};
