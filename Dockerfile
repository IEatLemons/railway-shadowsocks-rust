FROM rust:1.96.0-alpine3.23 AS builder

ARG SHADOWSOCKS_RUST_VERSION

RUN apk add --no-cache gcc musl-dev

RUN if [ -n "${SHADOWSOCKS_RUST_VERSION}" ]; then \
      cargo install shadowsocks-rust --version "${SHADOWSOCKS_RUST_VERSION}" --features full; \
    else \
      cargo install shadowsocks-rust --features full; \
    fi

FROM node:24-alpine3.23

RUN apk add --no-cache ca-certificates

COPY --from=builder /usr/local/cargo/bin/ssmanager /usr/bin/ssmanager

WORKDIR /app

COPY admin/package.json /app/admin/package.json
COPY admin/src /app/admin/src
COPY admin/public /app/admin/public
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 3000/tcp 8388/tcp 6100/udp

ENTRYPOINT ["/entrypoint.sh"]
