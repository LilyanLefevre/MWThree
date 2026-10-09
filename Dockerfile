# MWThree: the viewer, served with `vite preview`, sharing the game files mounted at /data.
# docker run -p 4173:4173 -v "/path/to/Call of Duty Modern Warfare 3:/data:ro" ghcr.io/lilyanlefevre/mwthree
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/iw5-core/package.json packages/iw5-core/
COPY packages/iw5-collision/package.json packages/iw5-collision/
COPY packages/viewer/package.json packages/viewer/
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY --from=build /app /app
# a folder with zone/<map>/mp_<map>.ff or zone/<language>/mp_<map>.ff, and main/*.iwd (an MW3 installation works as is)
ENV MWTHREE_INPUTS=/data
VOLUME /data
EXPOSE 4173
WORKDIR /app/packages/viewer
CMD ["npx", "vite", "preview", "--host", "0.0.0.0", "--port", "4173", "--strictPort"]
