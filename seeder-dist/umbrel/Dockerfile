# The PearSheet seeder with its web dashboard, for Umbrel and other Docker
# hosts. See proposals/2026-10-05-umbrel-seeder.md. The build context is
# dist/umbrel.
#
# Copies a payload staged on the build machine (node scripts/stage-umbrel.js:
# the Bare runtime, the seeder bundle with the target arch's addons and the
# dashboard), so nothing is compiled or installed under emulation. Built for
# amd64 and arm64 by scripts/build-umbrel-image.sh.
# rocksdb-native links libatomic.so.1, which the slim image lacks. Fetched for
# the target arch on the build machine's own arch, so no step runs emulated.
FROM --platform=$BUILDPLATFORM debian:bookworm-slim AS libatomic
ARG TARGETARCH
RUN dpkg --add-architecture $TARGETARCH \
 && apt-get update \
 && cd /tmp && apt-get download libatomic1:$TARGETARCH \
 && dpkg-deb -x libatomic1_*.deb /out

FROM node:22-bookworm-slim
ARG TARGETARCH
COPY --from=libatomic /out/usr/lib/ /usr/lib/
WORKDIR /app
COPY ${TARGETARCH}/ /app/
# Runs with host networking (devices dial in to pair; Docker's bridge NAT
# stops that), so it listens on every interface and the page asks for
# SEEDER_PASSWORD (Umbrel passes its app password; otherwise one is made and
# saved in /data).
ENV SEEDER_HOST=0.0.0.0 \
    SEEDER_PORT=8761 \
    SEEDER_DATA=/data \
    SEEDER_BARE=/app/bare \
    SEEDER_BUNDLE=/app/seeder/seeder.bundle
VOLUME /data
EXPOSE 8761
# Root, as Umbrel mounts ${APP_DATA_DIR} root-owned; compose sets
# no-new-privileges. The seeder stores only encrypted blocks.
CMD ["node", "/app/seeder-dist/umbrel/server.js"]
