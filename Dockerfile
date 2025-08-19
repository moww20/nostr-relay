FROM rust:1.75-slim as builder

WORKDIR /app
COPY . .

RUN cargo build --release

FROM debian:bookworm-slim

RUN apt-get update && apt-get install -y \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=builder /app/target/release/nostr-rs-relay /app/nostr-rs-relay
COPY --from=builder /app/config.toml /app/config.toml

EXPOSE 8080

CMD ["./nostr-rs-relay"]
