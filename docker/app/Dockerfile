FROM node:19-alpine3.16

WORKDIR /app

COPY package*.json ./

RUN npm install

EXPOSE 8080
COPY . .

CMD [ "node", "index.js" ]
