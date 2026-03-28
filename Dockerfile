FROM node:20-alpine
RUN apk add --no-cache openssh-client
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/
EXPOSE 3456
CMD ["node", "server/index.js"]
