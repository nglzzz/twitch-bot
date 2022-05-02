# twitch-bot

Run in docker:

1. Build:
```
docker build -t nglzzz/twitch-bot:1 -f docker/app/Dockerfile .
```

2. Run:
```
docker run -p 85:8080 nglzzz/twitch-bot:1
```

Run in docker-compose:

1. Run:
```
 docker-compose up
```

TODO List:

[] Public it as package

[] Add shortcodes

[] Middlewares for messages
