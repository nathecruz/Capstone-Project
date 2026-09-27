FROM node:22-bookworm-slim AS build

WORKDIR /app

COPY package*.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --omit=dev

COPY . .

ARG EXPO_PUBLIC_API_URL=http://localhost:8787
ARG EXPO_PUBLIC_AI_API_URL=http://localhost:8787
ARG EXPO_PUBLIC_AUTH_URL=http://localhost:8787
ENV CI=1
ENV EXPO_NO_TELEMETRY=1
ENV EXPO_PUBLIC_API_URL=${EXPO_PUBLIC_API_URL}
ENV EXPO_PUBLIC_AI_API_URL=${EXPO_PUBLIC_AI_API_URL}
ENV EXPO_PUBLIC_AUTH_URL=${EXPO_PUBLIC_AUTH_URL}

RUN npm run export:web

FROM nginx:alpine

COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD wget -q -O /dev/null http://127.0.0.1/ || exit 1