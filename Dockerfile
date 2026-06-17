FROM ghcr.io/shadowsocks/ssserver-rust:latest

USER root

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8388/tcp

ENTRYPOINT ["/entrypoint.sh"]
