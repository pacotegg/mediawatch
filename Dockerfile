# syntax=docker/dockerfile:1

# Etapa 1: Compilar la web cliente
FROM node:22-bookworm-slim AS build-web
WORKDIR /build

COPY package.json package-lock.json ./
COPY web/package.json ./web/
RUN npm ci --workspace web

COPY web/ ./web/
RUN npm run build --workspace web

# Etapa 2: Entorno de ejecución de Media Watch Server
FROM node:22-bookworm-slim
WORKDIR /app

# Instalar FFmpeg con soporte de aceleración VAAPI / Intel y certificados
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    libva-drm2 \
    intel-media-va-driver \
    mesa-va-drivers \
    ca-certificates \
    curl \
 && rm -rf /var/lib/apt/lists/*

# Dependencias del servidor
COPY package.json package-lock.json ./
COPY server/package.json ./server/
RUN npm ci --workspace server --omit=dev

# Código del servidor y web compilada
COPY server/ ./server/
COPY --from=build-web /build/web/dist ./web/dist

# Directorios de datos y medios
RUN mkdir -p /data /media

ENV NODE_ENV=production \
    MEDIAWATCH_DATA_DIR=/data \
    MEDIAWATCH_HOST=0.0.0.0 \
    MEDIAWATCH_PORT=8730 \
    MEDIAWATCH_FFMPEG=/usr/bin/ffmpeg \
    MEDIAWATCH_FFPROBE=/usr/bin/ffprobe

EXPOSE 8730

VOLUME ["/data", "/media"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD curl -f http://127.0.0.1:8730/api/salud || exit 1

CMD ["node", "--experimental-strip-types", "server/src/index.ts"]
