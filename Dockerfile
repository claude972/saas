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

# Copy the frontend source.
COPY apps/web/ ./

# NEXT_PUBLIC_* variables are inlined into the bundle at BUILD time. A Docker
# build does not automatically receive Railway service variables — they must be
# declared as ARG here so Railway passes them in. Without this, the build falls
# back to the localhost default in lib/api.ts and the frontend can't reach the
# API. Set NEXT_PUBLIC_API_URL in the Railway "web" service variables.
ARG NEXT_PUBLIC_API_URL
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL}

RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npm run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
