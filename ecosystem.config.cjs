/**
 * PM2 production processes: Next (UI + /api/*) and BullMQ worker.
 *
 * Prerequisites on the server:
 *   - Node.js 24+ (see .nvmrc and package.json engines)
 *   - pnpm install, pnpm db:migrate, pnpm build
 *   - .env at repo root (copy from .env.example; do not set NODE_ENV in .env)
 *
 * Usage:
 *   pm2 start ecosystem.config.cjs
 *   pm2 reload ecosystem.config.cjs --update-env
 *   pm2 save && pm2 startup
 */
const path = require('node:path');

const root = __dirname;

/** @type {import('pm2').StartOptions[]} */
const apps = [
  {
    name: 'gloaming-web',
    cwd: root,
    script: path.join(root, 'node_modules/next/dist/bin/next'),
    args: 'start',
    interpreter: 'node',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    listen_timeout: 10_000,
    kill_timeout: 5_000,
    env: {
      NODE_ENV: 'production',
      PORT: 3000,
    },
    env_file: '.env',
  },
  {
    name: 'gloaming-jobs',
    cwd: root,
    script: path.join(root, 'jobs/worker.ts'),
    interpreter: 'node',
    interpreter_args: '--import tsx',
    exec_mode: 'fork',
    instances: 1,
    autorestart: true,
    max_restarts: 10,
    min_uptime: '10s',
    kill_timeout: 30_000,
    env: {
      NODE_ENV: 'production',
    },
    env_file: '.env',
  },
];

module.exports = { apps };
