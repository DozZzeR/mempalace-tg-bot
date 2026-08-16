#!/usr/bin/env bash
# Back up the SQLite state store (allowlist, project registry, per-user sets).
#
#   deploy/backup-state.sh [destination-dir]
#
# Uses VACUUM INTO rather than cp. Copying a live SQLite file can capture a
# torn write; VACUUM INTO takes a consistent snapshot while the gateway keeps
# running. Keeps the last 14 snapshots.
set -euo pipefail

cd "$(dirname "$0")/.."

NODE="${MEMPALACE_BOT_NODE:-/home/alexdozer/.nvm/versions/node/v25.9.0/bin/node}"
SOURCE="${STATE_DB_PATH:-./data/state.sqlite}"
DEST_DIR="${1:-./data/backups}"
KEEP=14

if [ ! -f "${SOURCE}" ]; then
  echo "nothing to back up: ${SOURCE} does not exist" >&2
  exit 0
fi

mkdir -p "${DEST_DIR}"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
DEST="${DEST_DIR}/state-${STAMP}.sqlite"

"${NODE}" -e "
const { DatabaseSync } = require('node:sqlite');
const db = new DatabaseSync(process.argv[1], { readOnly: true });
db.exec(\`VACUUM INTO '\${process.argv[2].replaceAll(\"'\", \"''\")}'\`);
db.close();
" "${SOURCE}" "${DEST}"

echo "wrote ${DEST}"

# Prune oldest, keeping KEEP most recent.
ls -1t "${DEST_DIR}"/state-*.sqlite 2>/dev/null | tail -n "+$((KEEP + 1))" | while read -r old; do
  rm -f "${old}"
  echo "pruned ${old}"
done
