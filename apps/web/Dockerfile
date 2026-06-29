# Frontend image for the Next.js cockpit (apps/web).
#
# Mirrors the services/api Dockerfile pattern so Railway builds the frontend
# deterministically with the Docker builder, instead of the Railpack auto
# builder which mishandles the monorepo Root Directory (lstat apps/web bug).
#
# Railway: set the service Root Directory to `apps/web` so this Dockerfile and
# its build context resolve correctly.
FROM node:20-bookworm-slim

WORKDIR /app

# Install dependencies first for better layer caching.
COPY package.json package-lock.json ./
RUN npm ci

# Application code + production build.
COPY . .
RUN npm run build

EXPOSE 3000
CMD ["sh", "-c", "npm run start -- -H 0.0.0.0 -p ${PORT:-3000}"]
