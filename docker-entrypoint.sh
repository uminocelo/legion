#!/bin/sh
# Runs as root only long enough to make the data volume writable, then drops to "node".
set -e
if [ "$(id -u)" = "0" ]; then
  mkdir -p /app/data
  chown node:node /app/data 2>/dev/null || true
  exec setpriv --reuid=node --regid=node --init-groups "$@"
fi
exec "$@"
