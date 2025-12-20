#!/bin/bash
# Complete test and fix script - run this on VPS

set -e

echo "=== Complete Test and Fix ==="

# Fix nginx config
bash -c "$(cat << 'SCRIPT'
sudo rm -f /etc/nginx/sites-enabled/default
sudo tee /etc/nginx/sites-available/academyfirstaid > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name academyfirstaid.hackohackob.com;
    return 301 https://\$server_name\$request_uri;
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
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    client_max_body_size 10M;
}
EOF
sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/academyfirstaid
sudo nginx -t && sudo systemctl reload nginx
SCRIPT
)"

echo ""
echo "=== Checking Services ==="

# Check nginx
echo "Nginx status:"
sudo systemctl is-active nginx && echo "✅ Nginx is running" || echo "❌ Nginx is not running"

# Check if app container is running
echo ""
echo "Docker containers:"
docker ps | grep academyfirstaid || echo "⚠️  App container not running"

# Check if port 3000 is listening
echo ""
echo "Port 3000 status:"
sudo netstat -tlnp | grep :3000 || echo "⚠️  Nothing listening on port 3000"

# Test local connection
echo ""
echo "Testing local connection to app:"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" http://127.0.0.1:3000/api/decks || echo "❌ Cannot connect to app on port 3000"

# Test nginx
echo ""
echo "Testing nginx:"
curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" -k https://localhost/ || echo "⚠️  Nginx test failed"

echo ""
echo "=== Summary ==="
echo "If app container is not running, start it with:"
echo "cd /opt/academyfirstaid && docker-compose up -d"
echo ""
echo "View logs with:"
echo "cd /opt/academyfirstaid && docker-compose logs -f"
