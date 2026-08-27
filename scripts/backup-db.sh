#!/usr/bin/env bash
#
# Бэкап базы. Ставится в cron, см. docs/RUNBOOK.md.
#
#   ./scripts/backup-db.sh [dev|prod]
#
# Хранит 7 дней, как записано в правилах инфраструктуры. Пишет в
# /var/backups/mqbot, права 600 — в дампе персональные данные участников.
set -euo pipefail

ENVNAME="${1:-prod}"
DIR=${BACKUP_DIR:-/var/backups/mqbot}
KEEP_DAYS=${KEEP_DAYS:-7}
ENV_FILE="${ENV_FILE:-/srv/mqbot-prod/.env.$ENVNAME}"

[ -f "$ENV_FILE" ] || { echo "нет $ENV_FILE" >&2; exit 1; }

# Читаем ТОЛЬКО строку подключения: незачем тащить в окружение все секреты.
DATABASE_URL=$(grep -E '^DATABASE_URL=' "$ENV_FILE" | cut -d= -f2- | tr -d '"'"'"'')
[ -n "$DATABASE_URL" ] || { echo "в $ENV_FILE нет DATABASE_URL" >&2; exit 1; }

mkdir -p "$DIR"
chmod 700 "$DIR"

STAMP=$(date +%Y%m%d-%H%M%S)
OUT="$DIR/mqbot-$ENVNAME-$STAMP.sql.gz"

# --clean --if-exists: дамп разворачивается поверх существующей базы без
# ручной подчистки. Именно это и нужно в спешке.
pg_dump --clean --if-exists --no-owner --no-privileges "$DATABASE_URL" | gzip -9 > "$OUT.part"
mv "$OUT.part" "$OUT"
chmod 600 "$OUT"

# Пустой дамп — это не бэкап. Лучше упасть сейчас, чем обнаружить это,
# когда он понадобится.
SIZE=$(stat -c%s "$OUT")
[ "$SIZE" -gt 2048 ] || { echo "дамп подозрительно мал ($SIZE байт)" >&2; exit 1; }

find "$DIR" -name "mqbot-$ENVNAME-*.sql.gz" -mtime "+$KEEP_DAYS" -delete
find "$DIR" -name '*.part' -mmin +60 -delete

echo "бэкап: $OUT ($(numfmt --to=iec "$SIZE"))"
