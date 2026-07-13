# twitch-bot

Twitch-бот стримера `nglzzz`, дополненный мини-сайтом на уже существующей Node.js + Docker инфраструктуре.

## Что теперь есть

- главная страница `/` с блоком о стримере;
- встроенный Twitch-плеер и встроенный Twitch-чат;
- отдельная страница `/stats` со статистикой по viewer-срезам и chat-логам;
- JSON-эндпоинты `/api/streamer/summary` и `/api/streamer/stats` для будущих интеграций;
- логирование новых сообщений чата в `MongoDB`, если база подключена.

## Озвучка и OBS

Страница `/speak` показывает чат и управляет озвучкой. На ней есть кнопка для копирования
готового URL чистого чата в OBS. Добавляйте его как источник **«Браузер»**:

- `/speak?overlay=1` — прозрачный оверлей с озвучкой и сообщениями;
- `/speak?overlay=chat` — прозрачный оверлей только с чатом, без панели и аудио.

Оверлей автоматически отображает сторонние эмоуты 7TV, BetterTTV и FrankerFaceZ для
Twitch-канала. Каталоги обновляются в памяти раз в 30 минут; при недоступности одного
провайдера остальные продолжают работать.

### Внешние платформы чата

Оверлей принимает нормализованные сообщения от адаптеров Kick, VK Play, W.TV, GoodGame,
Trovo, WASD, YouTube и других площадок. Задайте длинный случайный
`OVERLAY_INGEST_TOKEN` в `.env` и отправляйте из адаптера запрос:

```http
POST /api/chat/messages
Authorization: Bearer <OVERLAY_INGEST_TOKEN>
Content-Type: application/json

{
  "platform": "kick",
  "nickname": "viewer",
  "message": "Привет из Kick!",
  "timestamp": 1783920000000
}
```

Поле `platform` используется как метка в чате; известные значения: `kick`, `vkplay`,
`w.tv`, `goodgame`, `trovo`, `wasd`, `youtube`, `twitch`. Неизвестные названия также
передаются как метка, поэтому для новой платформы не требуется менять оверлей.

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
