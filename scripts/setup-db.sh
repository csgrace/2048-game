#!/usr/bin/env bash
set -euo pipefail

DB="${1:-game2048}"
PSQL="${PSQL:-psql}"

echo "Creating database (if needed)..."
$PSQL -U postgres -tc "SELECT 1 FROM pg_database WHERE datame='$DB'" | grep -q 1 || \
  $PSQL -U postgres -c "CREATE DATABASE $DB;"

echo "Applying schema..."
$PSQL -U postgres -d "$DB" -f "$(dirname "$0")/../sql/init.sql"

echo "OK – database '$DB' ready."
