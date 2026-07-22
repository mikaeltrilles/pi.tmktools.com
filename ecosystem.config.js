module.exports = {
  apps: [
    {
      name: 'pi-tmktools',
      script: './server.js',
      args: '--port 3001',
      cwd: '/home/vote1550/pi.tmktools.com',
      instances: 1,
      exec_mode: 'fork',
      autorestart: true,
      restart_delay: 3000,
      max_memory_restart: '1G',
      kill_timeout: 10000,
      env: {
        NODE_ENV: 'production',
      },
      log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
      merge_logs: true,
      error_file: './logs/pi-tmktools-error.log',
      out_file: './logs/pi-tmktools-out.log',
      exp_backoff_restart_delay: 100,
    },
  ],
};
