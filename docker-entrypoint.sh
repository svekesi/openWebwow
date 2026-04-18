#!/bin/sh
set -e

echo "Running database migrations..."
npx knex migrate:latest --knexfile knexfile.ts
echo "Migrations complete."

echo "Starting Webwow on port ${PORT:-3002}..."
exec npx next start -p ${PORT:-3002}
