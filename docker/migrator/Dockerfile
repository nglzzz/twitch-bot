# Одноразовый migrator-образ: переносит данные MongoDB → SQLite.
# Содержит оба драйвера (mongodb + better-sqlite3), собранные под одну
# Node-версию, поэтому не зависит от окружения хоста.
#
# Сборка:  docker build -f docker/migrator/Dockerfile -t twitch-bot-migrator .
# Запуск:  docker run --rm \
#            -e MONGO_URI='mongodb+srv://...' \
#            -v <том_или_папка>:/app/data \
#            twitch-bot-migrator
# (по умолчанию пишет в /app/data/twitch-bot.sqlite; перекрывается через SQLITE_PATH)

FROM node:20-bookworm-slim

# build-тулчейн для нативной сборки better-sqlite3
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Ставим зависимости напрямую: npm install <pkg> зафиксирует версию в образе.
# better-sqlite3 пересобираем под Node 20 (надёжнее prebuilt).
# dotenv — чтобы можно было прокинуть MONGO_URI/SQLITE_PATH через .env.
RUN npm init -y \
  && npm install better-sqlite3@^11.10.0 mongodb dotenv \
  && npm rebuild better-sqlite3

# Копируем схему и скрипт миграции
COPY src/app/schema.js ./src/app/schema.js
COPY scripts/migrate-mongo-to-sqlite.js ./migrate.js

CMD ["node", "migrate.js"]
