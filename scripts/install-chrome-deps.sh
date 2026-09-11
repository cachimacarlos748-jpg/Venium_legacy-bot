#!/bin/sh
# Installs the shared libraries headless Chrome needs (WhatsApp Web bot).
# Runs on every `npm install` so sandbox restarts self-heal. Never fails the
# install: if apt or the packages are unavailable, Chrome simply keeps any
# libs already present (or PUPPETEER_EXECUTABLE_PATH points elsewhere).
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -qq >/dev/null 2>&1 || true
  apt-get install -y -qq \
    libglib2.0-0 libnss3 libnspr4 libatk1.0-0 libatk-bridge2.0-0 \
    libcups2 libdrm2 libxkbcommon0 libxcomposite1 libxdamage1 \
    libxfixes3 libxrandr2 libgbm1 libasound2 libpango-1.0-0 \
    libcairo2 libexpat1 fonts-liberation xdg-utils \
    >/dev/null 2>&1 || true
  echo "[install-chrome-deps] Chrome shared libraries ready."
else
  echo "[install-chrome-deps] apt-get not available; skipping."
fi
