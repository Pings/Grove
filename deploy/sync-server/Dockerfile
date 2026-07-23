FROM node:22-alpine
WORKDIR /app
COPY package.json ./
COPY server.mjs ./
RUN mkdir -p /data
ENV DATA_DIR=/data
ENV PORT=8090
EXPOSE 8090
CMD ["node", "server.mjs"]
