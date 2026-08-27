# Инфраструктура и деплой

## Что уже есть на сервере (проверено)

- IP `203.0.113.10`; `bot.example.com` и `bot-dev.example.com` **уже**
  резолвятся на него.
- **Traefik** в Docker (`/docker/traefik/docker-compose.yml`), `network_mode: host`,
  занимает `:80` и `:443`.
  - провайдер: docker, `exposedbydefault=false` → маршрут появляется только у
    контейнера с явными лейблами;
  - ACME/Let's Encrypt, HTTP-challenge, резолвер называется **`letsencrypt`**;
  - `:80` автоматически редиректит на `:443`.
- Node 22, pnpm, PostgreSQL client, ripgrep, jq, Chromium — установлены.

## Следствие

**Caddy/nginx не ставим.** Сертификаты и маршрутизацию делает Traefik.
Наша задача — только правильные лейблы на контейнере:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.mqbot.rule=Host(`bot.example.com`)
  - traefik.http.routers.mqbot.entrypoints=websecure
  - traefik.http.routers.mqbot.tls.certresolver=letsencrypt
  - traefik.http.services.mqbot.loadbalancer.server.port=3000
```

## Маршрутизация внутри домена

Один домен на стенд, разные пути:

| Путь | Куда |
|---|---|
| `/tg/<WEBHOOK_SECRET>` | вебхук Telegram |
| `/api/kie/callback` | callback от kie.ai |
| `/api/*` | REST для админки |
| `/g/<shortId>` | публичная страница результата (QR ведёт сюда) |
| `/` | админка (Next.js) |

Приоритеты роутеров Traefik: специфичные пути (`PathPrefix`) выше, чем `/`.

## dev-стенд

systemd + hot-reload:
- `mqbot-dev-bot.service` → `pnpm --filter bot dev` (tsx watch)
- `mqbot-dev-admin.service` → `pnpm --filter admin dev` (next dev)

Оба слушают на `127.0.0.1`. Чтобы Traefik (docker-провайдер) увидел сервис на
хосте, нужен **file-провайдер** — см. `docs/decisions/0001-reverse-proxy.md`,
раздел «Открытый вопрос».

## prod-стенд

⚠️ **Не Docker** — отдельный чекаут `/srv/mqbot-prod` под systemd
(ADR 0012). Причина: разработка идёт в `/projects/bot`, и `pnpm add`
там переписал бы `node_modules`, из которых работает прод.

- юниты `mqbot-prod-bot.service`, `mqbot-prod-admin.service`
  (`infra/systemd/`), `Restart=always`;
- бот запускается через `tsx` без watch: пакеты монорепо экспортируют
  `.ts`, и `node dist/index.js` падает на их импортах;
- админка собирается `next build` и запускается `next start`;
- маршруты — тот же file-провайдер Traefik (`infra/traefik/mqbot-prod.yml`),
  порты подставляются из `.env.prod` скриптом выката;
- выкат и откат — `scripts/deploy-prod.sh [ветка|тег]`, в конце smoke.

День фестиваля — `docs/RUNBOOK.md`.

## БД

PostgreSQL 16 в Docker, слушает **только** `127.0.0.1:5432`.
Две базы: `mqbot_dev` и `mqbot_prod`, разные роли и пароли.
Бэкап — `scripts/backup-db.sh` по cron (`/etc/cron.d/mqbot-backup`) в
`/var/backups/mqbot`, хранение 14 дней: прод каждые 4 часа, dev раз в
сутки. Скрипт проверяет размер дампа — пустой дамп это не бэкап.
⚠️ Медиа в дамп НЕ входят, это файлы на диске.

## Хранилище медиа

Локальный диск: `/var/lib/mqbot/<env>/media/<YYYY>/<MM>/<shortId>.jpg`.
Отдаётся Fastify по подписанной ссылке. S3 не нужен на текущем масштабе,
но интерфейс хранилища абстрагирован (`StorageAdapter`), чтобы переехать без боли.

## Чек-лист выката

1. `pnpm typecheck && pnpm lint && pnpm test`
2. Миграции: `pnpm db:migrate`
3. Поднять стенд, дождаться healthcheck `/api/health`
4. Переустановить вебхук Telegram на нужный домен
5. Проверить сертификат: `curl -sSI https://<домен>/api/health`
6. Прогнать smoke: генерация одной картинки end-to-end
