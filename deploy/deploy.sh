#!/usr/bin/env bash
# Deploy the current origin/main to this machine. Run it on the server.
#
#   ~/projects/mempalace-bot/deploy/deploy.sh
#
# Idempotent: safe to run repeatedly. It refuses to run over local edits rather
# than discarding them — a hotfix someone applied on the box should surface as
# a failed deploy, not vanish.
set -euo pipefail

cd "$(dirname "$0")/.."
ROOT="$(pwd)"
echo "deploying in ${ROOT}"

# Same reasoning as the interpreter pin in ecosystem.config.cjs: a
# non-interactive shell resolves `node` and `npm` to the system v18, which
# cannot run this project. Resolve both from the pinned Node instead of
# inheriting whatever PATH the caller happened to have.
NODE_BIN="${MEMPALACE_BOT_NODE:-/home/alexdozer/.nvm/versions/node/v25.9.0/bin/node}"
NODE_DIR="$(dirname "${NODE_BIN}")"
export PATH="${NODE_DIR}:${HOME}/.local/bin:${PATH}"
NPM="${NODE_DIR}/npm"

if [ -n "$(git status --porcelain)" ]; then
  echo "refusing to deploy: the working tree has local changes" >&2
  git status --short >&2
  exit 1
fi

PREVIOUS="$(git rev-parse HEAD)"
echo "current commit ${PREVIOUS}"

git fetch --prune origin
# --ff-only rather than reset --hard: if history diverged, stop and let a human
# look, instead of silently throwing away whatever is here.
git merge --ff-only origin/main

if [ ! -f .env ]; then
  echo "refusing to deploy: .env is missing — copy .env.example and fill it" >&2
  exit 1
fi

"${NPM}" ci --omit=dev

pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

echo
echo "deployed $(git rev-parse --short HEAD) (was ${PREVIOUS:0:7})"
echo "roll back with: deploy/rollback.sh ${PREVIOUS}"
pm2 list
