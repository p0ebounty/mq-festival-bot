#!/usr/bin/env bash
# Полная проверка проекта: типы, линт, unit, smoke, E2E.
# Запускать перед закрытием любой фазы.
set -uo pipefail
cd "$(dirname "$0")/.."
FAIL=0
step(){ printf '\n\033[1m▸ %s\033[0m\n' "$1"; }
res(){ if [ "$1" -eq 0 ]; then printf '  \033[32m✓ %s\033[0m\n' "$2"; else printf '  \033[31m✗ %s\033[0m\n' "$2"; FAIL=1; fi; }

step "typecheck"
for p in packages/config packages/db apps/bot apps/admin; do
  out=$( (cd "$p" && ./node_modules/.bin/tsc -p tsconfig.json --noEmit 2>&1) )
  [ -z "$out" ]; res $? "$p"
  [ -n "$out" ] && echo "$out" | head -6
done

step "lint (админка: запрет нативных элементов)"
out=$( (cd apps/admin && ../../node_modules/.bin/eslint src 2>&1) ); [ -z "$out" ]; res $? "eslint"
[ -n "$out" ] && echo "$out" | head -10

step "unit-тесты"
./node_modules/.bin/vitest run --reporter=dot 2>&1 | tail -6
res ${PIPESTATUS[0]:-0} "vitest"

step "smoke живого стенда"
./scripts/smoke.sh dev >/dev/null 2>&1; res $? "smoke dev"

step "E2E (Playwright)"
# Спеки сами пропускают себя, если нет их переменной: странице результата
# нужен E2E_SHORT_ID, админке — E2E_ADMIN_PASSWORD. Гонять их надо в любом
# случае: одна незаданная переменная не должна прятать вторую проверку.
if [ -n "${E2E_ADMIN_PASSWORD:-}" ] || [ -n "${E2E_SHORT_ID:-}" ]; then
  ./node_modules/.bin/playwright test --reporter=line 2>&1 | tail -4
  res ${PIPESTATUS[0]:-0} "playwright"
else
  printf '  \033[33m⊘ пропущено: ни E2E_ADMIN_PASSWORD, ни E2E_SHORT_ID не заданы\033[0m\n'
fi

echo
[ "$FAIL" -eq 0 ] && printf '\033[32m═══ ВСЁ ЗЕЛЁНОЕ ═══\033[0m\n' || printf '\033[31m═══ ЕСТЬ ПРОБЛЕМЫ ═══\033[0m\n'
exit $FAIL
