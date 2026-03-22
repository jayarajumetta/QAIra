FROM node:20-alpine

WORKDIR /app

COPY . .

WORKDIR /app/api

RUN npm install

WORKDIR /app

RUN chmod +x init-db.sh

EXPOSE 3000

CMD ["sh", "init-db.sh"]