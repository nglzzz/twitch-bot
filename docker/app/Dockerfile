FROM node:20-bookworm-slim

# Build toolchain для нативных модулей (better-sqlite3). При наличии prebuilt
# бинарников сборка не запускается, но инструменты нужны как запасной вариант.
RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./

RUN npm install

# better-sqlite3 — нативный модуль. Принудительно пересобираем его из исходников
# под Node-версию образа, чтобы не зависеть от prebuilt-бинарей под чужой ABI
# (иначе падает с NODE_MODULE_VERSION mismatch).
RUN npm rebuild better-sqlite3

EXPOSE 8080
COPY . .

CMD [ "node", "index.js" ]
