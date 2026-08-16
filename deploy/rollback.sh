#!/usr/bin/env bash
# Roll back to a specific commit and restart.
#
#   deploy/rollback.sh <commit-sha>
#
# Leaves the checkout detached on purpose: a rolled-back box should look
# obviously off-main, so the next person notices rather than deploying on top
# of a state nobody recorded.
set -euo pipefail

if [ $# -ne 1 ]; then
  echo "usage: $0 <commit-sha>" >&2
  exit 1
fi

cd "$(dirname "$0")/.."
TARGET="$1"

NODE_BIN="${MEMPALACE_BOT_NODE:-/home/alexdozer/.nvm/versions/node/v25.9.0/bin/node}"
NODE_DIR="$(dirname "${NODE_BIN}")"
export PATH="${NODE_DIR}:${HOME}/.local/bin:${PATH}"
NPM="${NODE_DIR}/npm"

git rev-parse --verify "${TARGET}^{commit}" >/dev/null 2>&1 || {
  echo "unknown commit: ${TARGET}" >&2
  exit 1
}

echo "rolling back from $(git rev-parse --short HEAD) to ${TARGET:0:7}"
git checkout --detach "${TARGET}"

"${NPM}" ci --omit=dev
pm2 startOrReload deploy/ecosystem.config.cjs --update-env
pm2 save

echo "rolled back to $(git rev-parse --short HEAD) (detached)"
echo "return to main with: git checkout main && deploy/deploy.sh"
