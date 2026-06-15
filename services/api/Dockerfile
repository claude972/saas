# API image WITH browser-use (Playwright + Chromium) for monitored-portal
# extraction. Heavier than the default railpack build — it is only worth using
# once browser-use is activated (BROWSER_USE_ENABLED=true). The API still boots
# and serves everything else exactly as before.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

# Python dependencies: core + optional veille/browser-use packages.
COPY requirements.txt requirements-veille.txt ./
RUN pip install --no-cache-dir -r requirements.txt -r requirements-veille.txt

# Chromium + its system libraries. `--with-deps` runs apt-get for us (we are
# root during the image build), which is the reliable way to get every shared
# library Chromium needs.
RUN playwright install --with-deps chromium

# Application code.
COPY . .

EXPOSE 8000
CMD ["sh", "-c", "uvicorn main:app --host 0.0.0.0 --port ${PORT:-8000}"]
