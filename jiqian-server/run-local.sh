#!/bin/sh
set -eu
cd "$(dirname "$0")"
if [ ! -f .env ]; then
  echo "缺少 jiqian-server/.env；请复制 .env.example 为 .env 并填写微信 AppSecret。" >&2
  exit 1
fi
set -a
. ./.env
set +a
exec ./mvnw spring-boot:run
