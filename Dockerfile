FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY src ./src
ENV THREADS_SYNC_STATE_DIR=/data/threads-sync
CMD ["npm", "run", "sync"]
