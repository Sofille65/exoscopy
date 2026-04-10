FROM node:20-alpine
RUN apk add --no-cache openssh-client openssh-keygen sshpass rsync
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --production
COPY server/ ./server/
COPY public/ ./public/
VOLUME /app/data
EXPOSE 3456
CMD ["node", "server/index.js"]
