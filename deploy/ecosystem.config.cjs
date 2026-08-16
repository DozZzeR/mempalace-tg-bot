const { resolve } = require("node:path");

/**
 * PM2 configuration for the Hetzner box.
 *
 * The interpreter is pinned to an absolute Node path on purpose. This machine
 * has three: the system /usr/bin/node (v18), the nvm default (v22.22), and
 * v25.9. Only v25 has `node:sqlite` unflagged, and a non-login shell resolves
 * `node` to v18 — so leaving the choice to PATH means the gateway starts or
 * fails depending on who launched it. Override with MEMPALACE_BOT_NODE.
 */
const NODE =
  process.env.MEMPALACE_BOT_NODE ??
  "/home/alexdozer/.nvm/versions/node/v25.9.0/bin/node";

const ROOT = resolve(__dirname, "..");

/** Shared settings. Logs go to PM2, which has pm2-logrotate installed. */
const common = {
  cwd: ROOT,
  interpreter: NODE,
  // Sources are TypeScript, executed through Node's type stripping — no build.
  interpreter_args: "--env-file-if-exists=./.env",
  autorestart: true,
  max_restarts: 10,
  restart_delay: 2000,
  max_memory_restart: "300M",
  time: true,
  merge_logs: true,
  env: { NODE_ENV: "production" },
};

module.exports = {
  apps: [
    {
      ...common,
      name: "mempalace-gateway",
      script: "apps/gateway/src/index.ts",
    },
    {
      ...common,
      name: "mempalace-bot",
      script: "apps/bot/src/index.ts",
    },
  ],
};
