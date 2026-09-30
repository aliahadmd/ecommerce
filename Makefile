.PHONY: help env install dev worker build up down reset logs ps migrate seed studio lint fmt typecheck test

help: ## list available targets
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-12s\033[0m %s\n", $$1, $$2}'

env: ## copy .env.example to .env if missing
	@test -f .env || cp .env.example .env
	@echo ".env ready"

install: ## install workspace dependencies
	pnpm install

dev: ## run the web app on the host (infra must be up: make up)
	pnpm dev

worker: ## run the background job worker (emails, notifications)
	pnpm worker

build: ## production build of the web app
	pnpm build

up: ## start infra containers (postgres, redis, seaweedfs, mailpit) and wait for health
	docker compose up -d --wait
	@echo "Infra up. Mailpit UI: http://localhost:8025  SeaweedFS master: http://localhost:9333"

down: ## stop infra containers (data is kept in named volumes)
	docker compose down

reset: ## stop infra and DELETE all data volumes
	docker compose down -v

logs: ## tail infra container logs
	docker compose logs -f --tail=100

ps: ## show infra container status
	docker compose ps

migrate: ## apply database migrations
	pnpm db:migrate

seed: ## seed demo data (idempotent)
	pnpm db:seed

studio: ## open drizzle studio (DB browser)
	pnpm db:studio

lint: ## lint all workspaces
	pnpm lint

fmt: ## format with prettier
	pnpm format

typecheck: ## typecheck all workspaces
	pnpm typecheck

test: ## run tests
	pnpm test
