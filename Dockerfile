FROM node:24-alpine
WORKDIR /app
COPY package.json ./
COPY db.js server.js test.js ./
COPY lib ./lib
COPY routes ./routes
COPY public ./public
RUN mkdir -p /app/data/uploads
ENV PORT=3000
ENV DATA_DIR=/app/data
EXPOSE 3000
CMD ["node", "server.js"]

