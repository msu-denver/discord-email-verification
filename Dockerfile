FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --production
COPY src/ ./src/
USER node
CMD ["node", "src/index.js"]
