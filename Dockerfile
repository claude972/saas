# Root-level Dockerfile for the Next.js frontend (apps/web).
#
# Built from the repository ROOT so the Railway "web" service needs NO Root
# Directory setting. This avoids the Railpack / monorepo path bug
# ("lstat apps/web: no such file") that happens when Root Directory = apps/web.
#
# Railway "web" service settings:
#   - Builder         : Dockerfile
#   - Root Directory  : (leave EMPTY / repo root)
#   - Dockerfile Path : Dockerfile
FROM node:20-bookworm-slim

WORKDIR /app

# Install deps from the apps/web manifests first (better layer caching).
COPY apps/web/package.json apps/web/package-lock.json ./
RUN npm ci

# Copy the frontend source and build it.
COPY apps/web/ ./
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npm run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
