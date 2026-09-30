# HabitAI Admin Panel: builds the React client, then serves it from the Express API.
FROM node:22-alpine AS client
WORKDIR /app/client
COPY client/package*.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

FROM node:22-alpine
ENV NODE_ENV=production
WORKDIR /app/server
COPY server/package*.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client /app/client/dist /app/client/dist
EXPOSE 4000
USER node
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:' + (process.env.API_PORT || process.env.PORT || 4000) + '/healthz').then(r => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"
CMD ["node", "src/index.js"]
