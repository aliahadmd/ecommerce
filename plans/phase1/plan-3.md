# Plan 3 — Docker Dev Environment

**Status:** Done
**Depends on:** plan-1
**Estimated effort:** half a day

---

## Goal

One command (`make up`) starts **four independent infra containers**: Postgres 17 + pgvector, Redis 7, SeaweedFS (S3-compatible), and Mailpit (SMTP + web UI). They expose plain TCP ports on `localhost` so the app (running on host) connects with only env vars. Nothing about the app is baked into these containers — that is what makes them swappable for external services in production.

## `docker-compose.yml` (full sketch)

```yaml
name: ecommerce

services:
  postgres:
    image: pgvector/pgvector:pg17
    container_name: ecommerce-postgres
    environment:
      POSTGRES_USER: ecommerce
      POSTGRES_PASSWORD: ecommerce
      POSTGRES_DB: ecommerce
    ports: ["5432:5432"]
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./docker/postgres/init:/docker-entrypoint-initdb.d:ro   # enables pgvector ext
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ecommerce -d ecommerce"]
      interval: 5s
      timeout: 3s
      retries: 10

  redis:
    image: redis:7-alpine
    container_name: ecommerce-redis
    command: ["redis-server", "--appendonly", "yes"]
    ports: ["6379:6379"]
    volumes: [redis_data:/data]
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 10

  seaweedfs:
    image: chrislusf/seaweedfs:latest        # pin an exact tag once verified
    container_name: ecommerce-seaweedfs
    command: >-
      server -dir=/data -ip=seaweedfs
      -master.port=9333 -volume.port=8080
      -filer -s3 -s3.port=8333
      -s3.config=/etc/seaweedfs/s3.json
      -master.volumeSizeLimitMB=1024
    ports: ["9333:9333", "8333:8333", "8888:8888"]
    volumes:
      - seaweed_data:/data
      - ./docker/seaweedfs/s3.json:/etc/seaweedfs/s3.json:ro

  mailpit:
    image: axllent/mailpit:latest
    container_name: ecommerce-mailpit
    environment:
      MP_MAX_MESSAGES: 5000
    ports: ["1025:1025", "8025:8025"]
    volumes: [mailpit_data:/data]

volumes:
  postgres_data:
  redis_data:
  seaweed_data:
  mailpit_data:
```

## Supporting files

**`docker/postgres/init/01-extensions.sql`**

```sql
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_trgm;   -- cheap text search for storefront
```

**`docker/seaweedfs/s3.json`** — gives SeaweedFS an S3 user matching `S3_ACCESS_KEY`/`S3_SECRET_KEY`:

```json
{
  "identities": [
    {
      "name": "ecommerce",
      "accessKey": "ecommerce-dev",
      "secretKey": "ecommerce-dev-secret",
      "actions": ["Admin", "Read", "Write", "List"]
    }
  ]
}
```

> Verify the `-s3.config` flag name and JSON shape against the image's docs for the pinned tag — these flags evolve; adjust rather than assume.

## Service cheat sheet (goes into README)

| Service | Container | Ports | Purpose |
| --- | --- | --- | --- |
| Postgres + pgvector | ecommerce-postgres | 5432 | all relational data; `CREATE EXTENSION vector` ready for AI |
| Redis | ecommerce-redis | 6379 | rate limits, caching; BullMQ later |
| SeaweedFS S3 | ecommerce-seaweedfs | **8333** S3 API, 9333 master UI, 8888 filer UI | product images |
| Mailpit | ecommerce-mailpit | **1025** SMTP, **8025** web UI | catches every dev email (verification, order mails) |

## Behavior & decisions

- **App runs on host, infra in Docker** (fastest DX: hot reload, native debugger). "Everything in Docker" is still honored: infra is 100% containerized, and an optional profile below runs the app itself in a container when needed.
- **Data persists in named volumes.** `make reset` (down -v) wipes everything for a clean slate.
- **Healthchecks + `--wait`**: `make up` blocks until Postgres and Redis report healthy, so `make migrate` right after always succeeds.
- **No hard-coded hosts in code** — only `.env` references `localhost`. Containers talk to each other over the compose network by service name if ever needed (e.g. optional app container uses `postgres` not `localhost`).

### Optional: run the app in Docker too (`--profile app`)

```yaml
  app:
    profiles: ["app"]
    image: node:22-alpine
    working_dir: /repo
    command: sh -c "corepack enable && pnpm install && pnpm dev --host"
    environment:
      DATABASE_URL: postgres://ecommerce:ecommerce@postgres:5432/ecommerce
      REDIS_URL: redis://redis:6379
      S3_ENDPOINT: http://seaweedfs:8333
      SMTP_HOST: mailpit
      # ...same contract as plan-1 §7, hostnames swapped to service names
    ports: ["3000:3000"]
    volumes: [.:/repo]
    depends_on:
      postgres: { condition: service_healthy }
      redis: { condition: service_healthy }
```

This proves the app is containerizable; it is **not** the day-to-day dev path. The production Dockerfile (the real one) is built in plan-11.

## Verification checklist

- [ ] `make up` → `docker compose ps` shows postgres & redis **healthy**, seaweedfs & mailpit running.
- [ ] `docker compose exec postgres psql -U ecommerce -d ecommerce -c "SELECT extname FROM pg_extension;"` lists `vector` and `pg_trgm`.
- [ ] `docker compose exec redis redis-cli ping` → `PONG`.
- [ ] `curl http://localhost:9333/cluster/status` returns JSON (SeaweedFS master up).
- [ ] S3 works: any S3 client (aws-cli or the plan-6 code) can list/create a bucket against `http://localhost:8333` with the dev keys.
- [ ] Mailpit UI at http://localhost:8025 loads; a test mail sent to `localhost:1025` appears in it.
- [ ] `make down` / `make reset` behave as documented.

## Explicitly not in this plan

Bucket creation & upload logic (plan-6), database schema (plan-4), production compose (plan-11 provides a `compose.prod.example.yml` shape for Dokploy mapping only).

---

## As-built note (2026-09-25)

As planned with two SeaweedFS fixes discovered during verification: s3.json needs the nested `credentials` array (modern format) and an `anonymous` identity with Read for public image URLs; image pinned to chrislusf/seaweedfs:3.80.
