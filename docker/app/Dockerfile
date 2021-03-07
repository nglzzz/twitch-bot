FROM node:15.6-alpine3.10

WORKDIR /app

COPY package*.json ./

RUN npm install

EXPOSE 8080
COPY . .

CMD [ "node", "index.js" ]
