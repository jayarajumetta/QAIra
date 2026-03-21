#!/bin/sh

echo "Initializing SQLite DB..."

sqlite3 $DB_PATH <<EOF
.read /app/db/schema.sql
.read /app/db/seed.sql
EOF

echo "Database initialized at $DB_PATH"

# Keep container running
tail -f /dev/null