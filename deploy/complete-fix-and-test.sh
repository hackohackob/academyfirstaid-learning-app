#!/bin/bash
# Complete fix and test - paste this on VPS

set -e

echo "=== Step 1: Fixing Nginx Configuration ==="

# Remove default site
sudo rm -f /etc/nginx/sites-enabled/default

# Create proper SSL config for academyfirstaid
sudo tee /etc/nginx/sites-available/academyfirstaid > /dev/null << 'NGINX_EOF'
server {
    listen 80;
    listen [::]:80;
    server_name academyfirstaid.hackohackob.com;
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name academyfirstaid.hackohackob.com;

    ssl_certificate /etc/letsencrypt/live/academyfirstaid.hackohackob.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/academyfirstaid.hackohackob.com/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    client_max_body_size 10M;
}
NGINX_EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/academyfirstaid

# Test and reload
sudo nginx -t && sudo systemctl reload nginx

echo ""
echo "=== Step 2: Checking Docker Container ==="

cd /opt/academyfirstaid

# Check if container exists and is running
if docker ps | grep -q academyfirstaid-app; then
    echo "✅ Container is running"
else
    echo "⚠️  Container not running, starting it..."
    docker-compose up -d
    sleep 5
fi

# Check container status
docker ps | grep academyfirstaid || echo "❌ Container failed to start"

echo ""
echo "=== Step 3: Testing Services ==="

# Test app on port 3000
echo "Testing app on port 3000:"
curl -s -o /dev/null -w "Status: %{http_code}\n" http://127.0.0.1:3000/api/decks || echo "❌ App not responding"

# Test nginx
echo ""
echo "Testing nginx:"
curl -s -o /dev/null -w "Status: %{http_code}\n" -k https://localhost/ || echo "⚠️  Nginx test"

# Test external URL
echo ""
echo "Testing external URL:"
curl -s -o /dev/null -w "Status: %{http_code}\n" https://academyfirstaid.hackohackob.com/ || echo "⚠️  External test"

echo ""
echo "=== Summary ==="
echo "Nginx status: $(sudo systemctl is-active nginx)"
echo "Container status: $(docker ps --format '{{.Status}}' --filter name=academyfirstaid-app 2>/dev/null || echo 'Not running')"
echo ""
echo "✅ Fix complete! Try accessing: https://academyfirstaid.hackohackob.com"
