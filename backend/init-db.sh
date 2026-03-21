#!/bin/sh

set -eu

echo "Initializing SQLite DB..."

mkdir -p "$(dirname "$DB_PATH")"

TABLE_COUNT="$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%';")"

if [ "${RESET_DB:-0}" = "1" ]; then
  echo "RESET_DB=1, recreating database file..."
  rm -f "$DB_PATH"
  TABLE_COUNT=0
fi

if [ "$TABLE_COUNT" = "0" ]; then
  sqlite3 "$DB_PATH" <<EOF
.read /app/db/schema.sql
.read /app/db/seed.sql
EOF
  echo "Database initialized at $DB_PATH"
else
  echo "Existing database detected at $DB_PATH, skipping schema and seed."
fi

tail -f /dev/null
