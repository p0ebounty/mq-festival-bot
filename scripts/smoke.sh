#!/usr/bin/env bash
# Проверка живого стенда. Использование: ./scripts/smoke.sh [dev|prod]
# Ничего не меняет, только читает. Безопасно запускать в любой момент.
set -uo pipefail
ENVNAME="${1:-dev}"
case "$ENVNAME" in
  dev)  HOST="bot-dev.example.com"; PORT=3001 ;;
  prod) HOST="bot.example.com";     PORT=4001 ;;
  *) echo "usage: $0 [dev|prod]"; exit 2 ;;
esac

PASS=0; FAIL=0
ok(){ printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
no(){ printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

echo "=== smoke: $ENVNAME ($HOST) ==="

echo "[локально]"
body=$(curl -sS --max-time 10 "http://127.0.0.1:$PORT/healthz" 2>/dev/null)
echo "$body" | grep -q '"ok":true' && ok "127.0.0.1:$PORT/healthz" || no "127.0.0.1:$PORT/healthz ($body)"

echo "[HTTPS]"
code=$(curl -sS --max-time 20 -o /tmp/smoke.$$ -w '%{http_code}' "https://$HOST/healthz" 2>/dev/null)
[ "$code" = "200" ] && ok "GET https://$HOST/healthz → 200" || no "GET https://$HOST/healthz → $code"
grep -q '"ok":true' /tmp/smoke.$$ 2>/dev/null && ok "тело health валидно" || no "тело health: $(head -c 80 /tmp/smoke.$$ 2>/dev/null)"
grep -q "\"env\":\"$ENVNAME\"" /tmp/smoke.$$ 2>/dev/null && ok "стенд отвечает как '$ENVNAME'" || no "стенд вернул не '$ENVNAME'"
rm -f /tmp/smoke.$$

echo "[TLS]"
vr=$(curl -sS --max-time 20 -o /dev/null -w '%{ssl_verify_result}' "https://$HOST/healthz" 2>/dev/null)
[ "$vr" = "0" ] && ok "сертификат валиден" || no "проверка сертификата: $vr"
exp=$(echo | openssl s_client -connect "$HOST:443" -servername "$HOST" 2>/dev/null | openssl x509 -noout -enddate 2>/dev/null | cut -d= -f2)
if [ -n "$exp" ]; then
  left=$(( ( $(date -d "$exp" +%s) - $(date +%s) ) / 86400 ))
  [ "$left" -gt 14 ] && ok "сертификат живёт ещё $left дн." || no "сертификат истекает через $left дн."
fi

echo "[редирект]"
rc=$(curl -sS --max-time 15 -o /dev/null -w '%{http_code}' "http://$HOST/healthz" 2>/dev/null)
[ "$rc" = "301" ] || [ "$rc" = "308" ] && ok "80 → 443 ($rc)" || no "редирект 80→443 вернул $rc"

echo "[инфраструктура]"
systemctl is-active --quiet "mqbot-$ENVNAME-bot.service" 2>/dev/null && ok "systemd mqbot-$ENVNAME-bot активен" \
  || { docker ps --format '{{.Names}}' | grep -q "mqbot-$ENVNAME" && ok "docker mqbot-$ENVNAME запущен" || no "сервис $ENVNAME не найден"; }
docker ps --format '{{.Names}}' | grep -q '^mqbot-postgres$' && ok "postgres запущен" || no "postgres не запущен"
[ "$(docker inspect mqbot-postgres --format '{{.State.Health.Status}}' 2>/dev/null)" = "healthy" ] && ok "postgres healthy" || no "postgres не healthy"
docker ps --format '{{.Names}}' | grep -q traefik && ok "traefik запущен" || no "traefik не запущен"

echo
printf 'итог: \033[32m%d ok\033[0m, \033[31m%d fail\033[0m\n' "$PASS" "$FAIL"
[ "$FAIL" -eq 0 ]
