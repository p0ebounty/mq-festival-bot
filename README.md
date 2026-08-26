# MQ Bot

Telegram AI-агент для фестиваля центра «Лидер» × MagnaQore.
Участник получает себя в «профессии будущего» или одной фразой перестраивает
выданный ему «базовый мир». Результат — картинка + QR-код для репоста.

**Бот — это один диалог, а не меню.** Всё делает LLM-агент с набором инструментов.

## Документация

| Файл | Что внутри |
|---|---|
| [CLAUDE.md](CLAUDE.md) | Точка входа, незыблемые правила |
| [docs/STATE.md](docs/STATE.md) | **Текущее состояние работы** |
| [docs/ROADMAP.md](docs/ROADMAP.md) | 11 фаз разработки |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | Архитектура |
| [docs/tz/original.md](docs/tz/original.md) | Исходное ТЗ |
| [docs/tz/analysis.md](docs/tz/analysis.md) | Разбор ТЗ, риски, вопросы |
| [docs/decisions/](docs/decisions/) | ADR — почему сделано именно так |
| [docs/vendor/kie/](docs/vendor/kie/) | Офлайн-зеркало документации kie.ai |

## Стенды

| | dev | prod |
|---|---|---|
| Домен | `bot-dev.example.com` | `bot.example.com` |
| Бот | [@example_dev_bot](https://t.me/example_dev_bot) | [@example_bot](https://t.me/example_bot) |
| Запуск | systemd + hot-reload | Docker Compose |
| БД | `mqbot_dev` | `mqbot_prod` |

## Быстрый старт

```bash
cp .env.example .env.dev   # заполнить значения
pnpm install
pnpm db:migrate
pnpm dev
```

## Стек

Node 22 · TypeScript · grammY · Fastify · PostgreSQL + Drizzle ·
Next.js + shadcn/ui · Traefik · kie.ai (`claude-opus-5` + `nano-banana-2`)
