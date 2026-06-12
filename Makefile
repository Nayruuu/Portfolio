# Makefile — super-dev-portfolio (monorepo)
# Commandes du quotidien. L'app Angular vit dans client/ ; la config Claude
# (.claude/, CLAUDE.md) et la doc restent à la racine.
# Compatible GNU Make 3.81 (macOS par défaut).

SHELL := /bin/bash
APP   := client

.PHONY: help install dev build build-prod build-ssg og gen-icons test test-cov e2e lint lint-fix format format-check check-docs clean

help: ## Affiche cette aide
	@grep -E '^[a-zA-Z_-]+:.*?## .*$$' $(MAKEFILE_LIST) | awk 'BEGIN {FS = ":.*?## "}; {printf "  \033[36m%-14s\033[0m %s\n", $$1, $$2}'

install: ## Installe les dépendances (npm ci dans client/)
	cd $(APP) && npm ci

dev: ## Démarre le serveur de dev (http://localhost:4200)
	cd $(APP) && npm start

build: ## Build (configuration production par défaut)
	cd $(APP) && npm run build

build-prod: ## Build production explicite
	cd $(APP) && npm run build:prod

build-ssg: ## Build prod + native Angular prerender + sitemap/robots/llms + SWA config
	cd $(APP) && npm run build:ssg

og: ## Regenerate the og:image social card (public/og-default.png)
	cd $(APP) && npm run gen:og

gen-icons: ## Regenerate the typed icon set (icon-set.ts) from icons/*.svg
	cd $(APP) && npm run gen:icons

test: ## Lance les tests unitaires (Vitest)
	cd $(APP) && npm test

test-cov: ## Tests unitaires + couverture + garde 100% sur core/
	cd $(APP) && npm run test:cov

e2e: ## Lance les tests E2E + régression visuelle (Playwright)
	cd $(APP) && npm run e2e

lint: ## Lint ESLint (angular-eslint + typescript-eslint)
	cd $(APP) && npm run lint

check-docs: ## Vérifie les docs du kit (refs §N, liens, prose-only PRODUCT.md, noms de config)
	node .claude/scripts/check-docs.mjs .

lint-fix: ## Lint avec correction automatique
	cd $(APP) && npm run lint:fix

format: ## Formate client/src avec Prettier
	cd $(APP) && npm run format

format-check: ## Vérifie le formatage sans modifier
	cd $(APP) && npm run format:check

clean: ## Supprime les artefacts de build
	rm -rf $(APP)/dist $(APP)/.angular/cache
