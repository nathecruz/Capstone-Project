FROM node:22-bookworm-slim

WORKDIR /app

RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .
RUN mkdir -p data/uploads

ENV NODE_ENV=production
EXPOSE 8787

CMD ["sh", "-c", "if [ -n \"$DATABASE_URL\" ]; then node scripts/migrate-neon.js; fi; node server.js"]
