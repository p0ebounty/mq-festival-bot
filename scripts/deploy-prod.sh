#!/usr/bin/env bash
#
# Выкат прод-стенда.
#
#   ./scripts/deploy-prod.sh [ветка|тег]
#
# Прод живёт в ОТДЕЛЬНОМ чекауте `/srv/mqbot-prod` (ADR 0012): в
# `/projects/bot` идёт разработка, и любой `pnpm add` там переписывает
# `node_modules`, из которых работал бы прод.
#
# Скрипт идемпотентен: можно гонять сколько угодно раз.
set -euo pipefail

PROD_DIR=${PROD_DIR:-/srv/mqbot-prod}
SOURCE_DIR=${SOURCE_DIR:-/projects/bot}
REF=${1:-master}
DOMAIN=${DOMAIN:-bot.example.com}

step() { printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
die()  { printf '\033[31m✗ %s\033[0m\n' "$1" >&2; exit 1; }

[ -f "$SOURCE_DIR/.env.prod" ] || die "нет $SOURCE_DIR/.env.prod"

step "чекаут $REF в $PROD_DIR"
if [ ! -d "$PROD_DIR/.git" ]; then
  git clone --no-hardlinks "$SOURCE_DIR" "$PROD_DIR"
fi
git -C "$PROD_DIR" remote set-url origin "$SOURCE_DIR"
git -C "$PROD_DIR" fetch origin --tags --prune
git -C "$PROD_DIR" checkout -B deploy "origin/$REF" 2>/dev/null \
  || git -C "$PROD_DIR" checkout "$REF"
printf '  коммит: %s\n' "$(git -C "$PROD_DIR" log --oneline -1)"

step "секреты"
# .env НЕ в git (правило 1 CLAUDE.md) — копируем из рабочего каталога.
install -m 600 "$SOURCE_DIR/.env.prod" "$PROD_DIR/.env.prod"

step "зависимости"
( cd "$PROD_DIR" && pnpm install --frozen-lockfile --config.confirmModulesPurge=false )

step "сборка"
( cd "$PROD_DIR/apps/bot" && ./node_modules/.bin/tsc -p tsconfig.json )
( cd "$PROD_DIR/apps/admin" && APP_ENV=prod NODE_ENV=production ./node_modules/.bin/next build )

step "миграции"
( cd "$PROD_DIR" && APP_ENV=prod pnpm db:migrate )

step "наполнение (профессии, миры, настройки)"
( cd "$PROD_DIR/apps/admin" && APP_ENV=prod ./node_modules/.bin/tsx scripts/seed-admin.mts ) || true
( cd "$PROD_DIR" && APP_ENV=prod ./node_modules/.bin/tsx scripts/seed-content.mts ) || true

step "systemd"
for unit in mqbot-prod-bot mqbot-prod-admin; do
  install -m 644 "$PROD_DIR/infra/systemd/$unit.service" "/etc/systemd/system/$unit.service"
done
systemctl daemon-reload
systemctl enable --now mqbot-prod-bot mqbot-prod-admin
systemctl restart mqbot-prod-bot mqbot-prod-admin

step "маршруты Traefik"
# Порты берём из .env.prod, а не пишем в конфиг руками: два источника
# правды однажды разъедутся, и Traefik пойдёт стучаться не туда.
BOT_PORT=$(grep -E '^PORT=' "$PROD_DIR/.env.prod" | cut -d= -f2 | tr -d '"'"'"' ')
ADMIN_PORT=$(grep -E '^ADMIN_PORT=' "$PROD_DIR/.env.prod" | cut -d= -f2 | tr -d '"'"'"' ')
[ -n "$BOT_PORT" ] || die "в .env.prod нет PORT"
[ -n "$ADMIN_PORT" ] || die "в .env.prod нет ADMIN_PORT"
printf '  бот :%s, админка :%s\n' "$BOT_PORT" "$ADMIN_PORT"

sed -e "s/__BOT_PORT__/$BOT_PORT/" -e "s/__ADMIN_PORT__/$ADMIN_PORT/" \
  "$PROD_DIR/infra/traefik/mqbot-prod.yml" > /docker/traefik/dynamic/mqbot-prod.yml
chmod 644 /docker/traefik/dynamic/mqbot-prod.yml

step "ждём подъёма"
for i in $(seq 1 30); do
  if curl -sS -o /dev/null "https://$DOMAIN/healthz" 2>/dev/null; then break; fi
  sleep 2
done

step "smoke"
BOT_PORT="$BOT_PORT" "$PROD_DIR/scripts/smoke.sh" prod || die "smoke не прошёл — стенд не готов"

printf '\n\033[32m═══ ПРОД ВЫКАЧЕН: https://%s ═══\033[0m\n' "$DOMAIN"
printf 'откат: ./scripts/deploy-prod.sh <прошлый тег>\n'
