# twitch-bot

Twitch-бот стримера `nglzzz`, дополненный мини-сайтом на уже существующей Node.js + Docker инфраструктуре.

## Что теперь есть

- главная страница `/` с блоком о стримере;
- встроенный Twitch-плеер и встроенный Twitch-чат;
- отдельная страница `/stats` со статистикой по viewer-срезам и chat-логам;
- JSON-эндпоинты `/api/streamer/summary` и `/api/streamer/stats` для будущих интеграций;
- логирование новых сообщений чата в `MongoDB`, если база подключена.

## Источники данных мини-сайта

- **Twitch API** — live-статус, название стрима, категория, viewer count;
- **Mongo / `viewer`** — история viewer-срезов, средний и пиковый онлайн;
- **Mongo / `chatLog`** — последние сообщения и топ чаттеров;
- **оперативная память бота** — fallback, если MongoDB временно недоступна.

## Локальный запуск

```bash
npm install
npm start
```

Проверка, что view-model сайта собирается без ошибок:

```bash
npm test
```

## Запуск в Docker

Сборка образа:

```bash
docker build -t nglzzz/twitch-bot:1 -f docker/app/Dockerfile .
```

Запуск контейнера:

```bash
docker run -p 85:8080 nglzzz/twitch-bot:1
```

## Запуск через docker-compose

```bash
docker-compose up --build
```

После старта проверь:

- `http://localhost/` — мини-сайт;
- `http://localhost/stats` — подробная статистика;
- `http://localhost/api/streamer/summary` — краткая JSON-сводка;
- `http://localhost/api/streamer/stats` — подробная JSON-статистика.

## Примечания по окружению

- для live-блока нужны `TWITCH_API_CLIENT_ID` и `TWITCH_ACCESS_TOKEN`;
- для статистики из БД нужна рабочая Mongo-конфигурация (`MONGO_*`);
- Twitch embed требует корректный `parent` hostname, он вычисляется автоматически из запроса;
- если проект стоит за reverse proxy / docker ingress и наружный домен отличается от того, что видит контейнер, задай `SITE_PUBLIC_HOST=your-domain.example` в `.env`.
