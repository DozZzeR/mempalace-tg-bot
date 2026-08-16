# Deployment — Hetzner

Two processes under PM2: `mempalace-gateway` and `mempalace-bot`.

Layout on the box, under `~/projects/mempalace_bot_project/`
(`/opt/projects/mempalace_bot_project/`):

```
mempalace_bot_project/
├── bot/      this repository
└── model/    Codex's working directory — must stay empty
```

`model/` is a **sibling** of the repo, not a child, and that is the whole point:
Codex walks up from its working directory looking for `AGENTS.md` and
`.agents/skills`, so any path beneath `bot/` would feed our coding-agent
instructions to the model that answers people. Putting it in a subfolder of the
repo does not help — it is the repo root being an ancestor that matters.

## Why these choices

**PM2, not systemd.** The box already runs PM2 with `pm2-alexdozer.service`
enabled at boot and the `pm2-logrotate` module installed, and `dozerclaw` runs
under it. Adding a second supervisor would mean two places to look when
something is down.

**The Node path is pinned absolutely** in `ecosystem.config.cjs`. This machine
has three Node versions — system v18, nvm default v22.22, and v25.9 — and a
non-login shell resolves `node` to v18. Only v25 has `node:sqlite` unflagged,
so leaving the choice to `PATH` makes the gateway start or fail depending on
who launched it.

**Long polling, not a webhook** (closes D-7). The bot runs on the same box as
the gateway, which binds to loopback only. Polling needs no inbound port, no
TLS certificate and no reverse-proxy entry. A webhook would buy lower latency
at the cost of exposing a public endpoint — not a trade worth making for a bot
with this traffic.

**The palace is reached over loopback.** `mem-palace-common-http` already runs
on the box at `127.0.0.1:4118` with `MEMPALACE_CONTEXT_WINGS=projects` and
`MEMPALACE_CONTEXT_REQUIRE_WING=true`. Nothing crosses the network and no
credential leaves the machine.

## First-time setup

```bash
git clone git@github.com:DozZzeR/mempalace-tg-bot.git ~/projects/mempalace-bot
```

```bash
cd ~/projects/mempalace-bot && cp .env.example .env
```

Fill `.env`. It is gitignored and deploys never touch it:

- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT`
- `GATEWAY_TOKEN` — shared secret between the two processes, any long random string
- `GATEWAY_URL=http://127.0.0.1:8787`
- `PALACE_URL=http://127.0.0.1:4118/mcp`
- `PALACE_AUTHORIZATION=Bearer <the common container's bearer token>`
- `STATE_DB_PATH=./data/state.sqlite`

Then:

```bash
cd ~/projects/mempalace-bot && npm ci --omit=dev && pm2 start deploy/ecosystem.config.cjs && pm2 save
```

## Routine deploy

```bash
~/projects/mempalace-bot/deploy/deploy.sh
```

Fetches, fast-forwards to `origin/main`, installs, reloads both processes and
saves the PM2 process list. It refuses to run when the working tree is dirty:
a hotfix applied on the box should surface as a failed deploy, not vanish.

## Rollback

```bash
~/projects/mempalace-bot/deploy/rollback.sh <commit-sha>
```

`deploy.sh` prints the previous commit when it finishes, so the rollback
command is always one scroll up. The checkout is left detached deliberately —
a rolled-back box should look obviously off-main.

## Logs

```bash
pm2 logs mempalace-bot --lines 100
```

```bash
pm2 logs mempalace-gateway --lines 100
```

Rotation is handled by the `pm2-logrotate` module already installed on the box.

## State backup

```bash
~/projects/mempalace-bot/deploy/backup-state.sh
```

Writes a timestamped snapshot to `data/backups/` and keeps the last 14. It uses
`VACUUM INTO`, not `cp`: copying a live SQLite file can capture a torn write.

To run it nightly:

```bash
crontab -l 2>/dev/null | { cat; echo "17 4 * * * ~/projects/mempalace-bot/deploy/backup-state.sh >/dev/null 2>&1"; } | crontab -
```

## Checking it survived a reboot

```bash
pm2 list && curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:8787/healthz
```
