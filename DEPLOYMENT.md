# NOSTR Relay Deployment Guide

This guide covers deploying the NOSTR relay in production environments.

## Quick Start

### Prerequisites

- Rust toolchain (install via [rustup](https://rustup.rs/))
- SQLite (included with rusqlite bundled feature)
- A server with at least 1GB RAM and 10GB storage

### Building for Production

```bash
# Clone the repository
git clone <your-repo-url>
cd nostr-rs-relay

# Build optimized release version
cargo build --release

# The binary will be at target/release/nostr-rs-relay
```

### Running the Relay

```bash
# Run with default configuration
./target/release/nostr-rs-relay

# Run with custom configuration
./target/release/nostr-rs-relay --config /path/to/config.toml
```

## Production Configuration

### Recommended config.toml for Production

```toml
[server]
host = "0.0.0.0"  # Listen on all interfaces
port = 8080
max_connections = 5000

[database]
path = "/var/lib/nostr-relay/nostr_relay.db"
max_connections = 20

[limits]
max_event_size = 16384
max_events_per_request = 1000
max_filters_per_subscription = 10
max_subscriptions_per_connection = 10
rate_limit_events_per_second = 100

[relay]
name = "Your Relay Name"
description = "Your relay description"
pubkey = "your_pubkey_here"  # Optional
contact = "your_contact_info"  # Optional
supported_nips = [1, 11, 42]
software = "nostr-rs-relay"
version = "0.1.0"
```

## Docker Deployment

### Dockerfile

```dockerfile
FROM rust:1.70 as builder
WORKDIR /app
COPY . .
RUN cargo build --release

FROM debian:bullseye-slim
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/target/release/nostr-rs-relay /usr/local/bin/
COPY --from=builder /app/config.toml /etc/nostr-relay/
EXPOSE 8080
CMD ["nostr-rs-relay", "--config", "/etc/nostr-relay/config.toml"]
```

### Docker Compose

```yaml
version: '3.8'
services:
  nostr-relay:
    build: .
    ports:
      - '8080:8080'
    volumes:
      - nostr-data:/var/lib/nostr-relay
    restart: unless-stopped
    environment:
      - RUST_LOG=info

volumes:
  nostr-data:
```

## Systemd Service

Create `/etc/systemd/system/nostr-relay.service`:

```ini
[Unit]
Description=NOSTR Relay
After=network.target

[Service]
Type=simple
User=nostr
WorkingDirectory=/opt/nostr-relay
ExecStart=/opt/nostr-relay/nostr-rs-relay --config /etc/nostr-relay/config.toml
Restart=always
RestartSec=10
Environment=RUST_LOG=info

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/nostr-relay

[Install]
WantedBy=multi-user.target
```

### Setup Systemd Service

```bash
# Create user
sudo useradd -r -s /bin/false nostr

# Create directories
sudo mkdir -p /opt/nostr-relay
sudo mkdir -p /var/lib/nostr-relay
sudo mkdir -p /etc/nostr-relay

# Copy files
sudo cp target/release/nostr-rs-relay /opt/nostr-relay/
sudo cp config.toml /etc/nostr-relay/

# Set permissions
sudo chown -R nostr:nostr /opt/nostr-relay
sudo chown -R nostr:nostr /var/lib/nostr-relay
sudo chown -R nostr:nostr /etc/nostr-relay

# Enable and start service
sudo systemctl daemon-reload
sudo systemctl enable nostr-relay
sudo systemctl start nostr-relay
```

## Reverse Proxy Setup

### Nginx Configuration

```nginx
server {
    listen 80;
    server_name your-relay-domain.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### SSL with Let's Encrypt

```bash
# Install certbot
sudo apt install certbot python3-certbot-nginx

# Get SSL certificate
sudo certbot --nginx -d your-relay-domain.com

# Auto-renewal
sudo crontab -e
# Add: 0 12 * * * /usr/bin/certbot renew --quiet
```

## Monitoring and Logging

### Log Management

```bash
# View logs
sudo journalctl -u nostr-relay -f

# Log rotation
sudo nano /etc/logrotate.d/nostr-relay
```

Add to `/etc/logrotate.d/nostr-relay`:

```
/var/log/nostr-relay/*.log {
    daily
    missingok
    rotate 52
    compress
    delaycompress
    notifempty
    create 644 nostr nostr
}
```

### Health Checks

The relay provides a health endpoint at `/health`:

```bash
curl http://localhost:8080/health
```

Expected response:

```json
{
  "status": "healthy",
  "timestamp": 1234567890
}
```

## Performance Tuning

### Database Optimization

```sql
-- Analyze database for better query planning
ANALYZE;

-- Check database size
SELECT page_count * page_size as size FROM pragma_page_count(), pragma_page_size();

-- Monitor slow queries
PRAGMA temp_store = memory;
PRAGMA cache_size = 10000;
PRAGMA synchronous = NORMAL;
```

### System Tuning

```bash
# Increase file descriptor limits
echo "* soft nofile 65536" >> /etc/security/limits.conf
echo "* hard nofile 65536" >> /etc/security/limits.conf

# Kernel parameters
echo "net.core.somaxconn = 65536" >> /etc/sysctl.conf
echo "net.ipv4.tcp_max_syn_backlog = 65536" >> /etc/sysctl.conf
sysctl -p
```

## Backup Strategy

### Database Backup

```bash
#!/bin/bash
# backup.sh
BACKUP_DIR="/var/backups/nostr-relay"
DATE=$(date +%Y%m%d_%H%M%S)
DB_PATH="/var/lib/nostr-relay/nostr_relay.db"

mkdir -p $BACKUP_DIR
sqlite3 $DB_PATH ".backup '$BACKUP_DIR/nostr_relay_$DATE.db'"

# Keep only last 7 days of backups
find $BACKUP_DIR -name "nostr_relay_*.db" -mtime +7 -delete
```

### Automated Backup

```bash
# Add to crontab
0 2 * * * /path/to/backup.sh
```

## Security Considerations

1. **Firewall**: Only expose necessary ports (80, 443)
2. **User Permissions**: Run as non-root user
3. **Database Security**: Ensure database file has proper permissions
4. **Rate Limiting**: Configure appropriate rate limits
5. **Monitoring**: Set up alerts for unusual activity

## Troubleshooting

### Common Issues

1. **Port already in use**: Check if another service is using port 8080
2. **Permission denied**: Ensure proper file permissions
3. **Database locked**: Check for concurrent access issues
4. **Memory issues**: Monitor memory usage and adjust limits

### Debug Mode

```bash
# Run with debug logging
RUST_LOG=debug ./nostr-rs-relay --config config.toml
```

### Database Maintenance

```bash
# Check database integrity
sqlite3 nostr_relay.db "PRAGMA integrity_check;"

# Rebuild database
sqlite3 nostr_relay.db "VACUUM;"
```

## Scaling Considerations

For high-traffic relays:

1. **Load Balancing**: Use multiple relay instances behind a load balancer
2. **Database**: Consider using a more robust database like PostgreSQL
3. **Caching**: Implement Redis for caching frequently accessed data
4. **Monitoring**: Use tools like Prometheus and Grafana for metrics
