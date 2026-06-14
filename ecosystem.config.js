module.exports = {
  apps: [{
    name: 'invest-platform',
    script: './dist/server/entry.mjs',
    instances: 1,
    exec_mode: 'fork',
    env: {
      NODE_ENV: 'production',
      DB_HOST: '204.44.121.43',
      DB_PORT: '3306',
      DB_USER: 'mnigc',
      DB_PASSWORD: 'woaiyinyue.4',
      DB_NAME: 'invest_platform',
      SITE_URL: 'https://your-domain.com',
      PORT: '4321',
      HOST: '0.0.0.0',
    },
    env_file: '.env',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    merge_logs: true,
  }],
};
