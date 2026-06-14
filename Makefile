# BTP OpenClaw Cockpit — developer shortcuts
# Usage: make <target>

.PHONY: help db db-down api web seed

help:
	@echo "Targets:"
	@echo "  make db        Start the PostgreSQL database (docker compose, detached)"
	@echo "  make db-down   Stop the database container"
	@echo "  make api       Run the FastAPI backend (uvicorn, port 8000)"
	@echo "  make web       Run the Next.js frontend (port 3000)"
	@echo "  make seed      Seed the database (agents, demo data)"

db:
	docker compose up -d db

db-down:
	docker compose down

api:
	cd services/api && uvicorn main:app --reload --port 8000

web:
	cd apps/web && npm run dev

seed:
	cd services/api && python seed.py
