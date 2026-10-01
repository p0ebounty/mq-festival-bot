# MQ Bot

A Telegram AI agent built for a live festival run by the «Лидер» center × MagnaQore.
Participants send a selfie and see themselves in a "profession of the future", or
rebuild a generated "base world" with a single phrase. Every result comes back as
an image plus a QR code that links to a share page.

**The bot is one conversation, not a menu.** There are no button trees or wizards:
an LLM agent with a set of tools understands plain language and decides what to do.
Buttons exist only as optional shortcuts — every scenario works with text alone.

## Features

- **Agent-first UX** — a tool-use loop where the model picks the tool and the image
  to edit; conversation state lives in the dialog history, not in an FSM.
- **Image generation & editing** — "make me an astronaut", "turn the castle into a
  space station", "make it night". A router picks the image model per task and falls
  back to the next one on errors, rate limits or timeouts.
- **Base worlds & tasks** — the agent hands out starter worlds and challenge tasks
  (an image plus a goal) from a pool managed in the database.
- **Token economy** — a per-user balance, charged before each generation and
  refunded automatically on failure; every movement goes to a ledger.
- **Social bonus** — a user sends a link to their post; a headless browser opens it
  and compares the perceptual hash of the image on the page with the generation.
  A narrow verifier sub-agent only runs when code alone can't decide.
- **Moderation** — a classifier checks every prompt before tokens are charged
  (fail-closed), with a short stop-list as a fallback.
- **Share pages & QR codes** — every result gets a permanent short link with a
  download page and hashtags; the QR code is rendered on the fly.
- **Admin panel** — dashboard, users, dialogs with expanded tool calls, generations
  gallery, social claims, audit log, and live settings (provider key, agent model,
  economy) with realtime updates via `pg_notify` + SSE.
- **Sleep mode** — one switch puts the bot to sleep after the event while users can
  still download their results.

## Architecture

```
Telegram ──webhook──► Traefik (TLS) ──► apps/bot   (Fastify + grammY)
                                    └─► apps/admin (Next.js)
                                             │
                    packages/core · db · config
                                             │
                     PostgreSQL       media storage (local disk)
                                             │
                     kie.ai: LLM (agent brain) + Jobs API (images) ──callback──► /api/kie/callback
```

Image generation is asynchronous: the tool creates a job and immediately returns
"accepted", the agent tells the user it's working, and the finished image is
delivered by the provider callback (with a polling worker as a fallback).

More detail: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) and the ADRs in
[docs/decisions/](docs/decisions/) (documentation is in Russian).

## Repository structure

```
apps/
  bot/       Fastify + grammY: Telegram webhook, REST for the admin, /g/ share pages, provider callback
  admin/     Next.js App Router admin panel (shadcn/ui)
packages/
  core/      agent loop, tools, prompts, image router, kie.ai client, storage, QR / share pages
  db/        Drizzle schema, migrations, repositories
  config/    typed env + settings stored in the DB (AES-256-GCM encrypted secrets)
infra/       systemd units, Traefik file-provider routes, Postgres compose
scripts/     deploy, backups, smoke tests, live end-to-end scenarios
docs/        architecture, roadmap, runbook, ADRs, experiments
```

## Tech stack

Node 22 · TypeScript (strict) · grammY · Fastify · PostgreSQL 16 + Drizzle ORM ·
Next.js + React + Tailwind + shadcn/ui · TanStack Table · zod · Vitest · Playwright ·
Traefik · systemd · kie.ai (LLM + image models)

## Getting started

Requirements: Node 22+, pnpm, PostgreSQL 16.

```bash
cp .env.example .env.dev   # fill in your values
pnpm install
pnpm db:migrate
pnpm --filter @mq/admin seed   # create the admin user
pnpm dev                   # bot + admin with hot reload
```

Key environment variables (see [.env.example](.env.example)):

| Variable | Purpose |
|---|---|
| `PUBLIC_URL` | Public HTTPS URL of the deployment, e.g. `https://bot.example.com` |
| `TELEGRAM_BOT_TOKEN` | Token from @BotFather (use a separate bot per environment) |
| `TELEGRAM_WEBHOOK_SECRET` | Random string for the webhook path and secret header |
| `DATABASE_URL` | PostgreSQL connection string |
| `SECRETS_ENC_KEY` | 64 hex chars, encrypts secrets stored in the DB |
| `KIE_API_KEY` | Bootstrap only — normally set in the admin panel |
| `ADMIN_SESSION_SECRET` | Admin session signing secret |

## Scripts

```bash
pnpm test            # unit + integration tests
pnpm test:e2e        # Playwright tests for the admin panel
pnpm test:live       # real provider calls (spends credits)
pnpm typecheck && pnpm lint
./scripts/smoke.sh dev
```

## Notes

- Bot replies and in-repo docs are in Russian — the audience was festival participants.
- Code, identifiers and commit messages are in English.
