#!/bin/sh
# Railway/Northflank volumes attach as root-owned. Fix ownership of /app/data
# on each boot so the unprivileged "node" user can write SQLite and the
# WhatsApp session, then drop privileges and exec the server.
set -e

mkdir -p /app/data 2>/dev/null || true
chown -R node:node /app/data 2>/dev/null || true

if [ "$(id -u)" = "0" ]; then
  exec gosu node "$@"
fi

exec "$@"
