FROM node:18-alpine

RUN apk add --no-cache python3 make g++

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm install --production && rm -rf /root/.npm

COPY src/ ./src/
COPY migrations/ ./migrations/

EXPOSE 3000

CMD ["node", "src/index.js"]
