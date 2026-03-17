FROM node:20-alpine

WORKDIR /app

COPY package*.json ./

RUN apk add --no-cache bash curl openssl gcompat iproute2 coreutils procps \
    && npm install --omit=dev

COPY . .

EXPOSE 3000

CMD ["node", "index.js"]
