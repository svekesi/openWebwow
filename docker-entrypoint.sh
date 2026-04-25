#!/bin/sh
set -e

echo "Running database migrations..."
npx knex migrate:latest --knexfile knexfile.ts
echo "Migrations complete."

echo "Provisioning default API key + webhooks..."
if ! npx ts-node scripts/provision-default-integrations.ts; then
  echo "Default provisioning failed, continuing startup."
fi

echo "Starting Webwow on port ${PORT:-3002}..."
exec npx next start -p ${PORT:-3002}
