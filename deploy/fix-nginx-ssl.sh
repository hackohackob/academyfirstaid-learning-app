#!/bin/bash
# ⚠️ WARNING: THIS SCRIPT IS FOR THE VPS SERVER (hackohackob.com) ONLY!
# Fix nginx SSL configuration for academyfirstaid

set -e

echo "=== Fixing Nginx SSL Configuration ==="

# Remove default site if it exists
sudo rm -f /etc/nginx/sites-enabled/default

# Create proper SSL-enabled nginx config for academyfirstaid
sudo tee /etc/nginx/sites-available/academyfirstaid > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name academyfirstaid.hackohackob.com;

    # Redirect HTTP to HTTPS
    return 301 https://$server_name$request_uri;
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name academyfirstaid.hackohackob.com;

    # SSL certificates
    ssl_certificate /etc/letsencrypt/live/academyfirstaid.hackohackob.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/academyfirstaid.hackohackob.com/privkey.pem;
    
    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers HIGH:!aNULL:!MD5;
    ssl_prefer_server_ciphers on;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    # Proxy to Node.js app
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
        
        # Timeouts
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # Increase max body size for image uploads
    client_max_body_size 10M;
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/academyfirstaid

# Test nginx configuration
echo "Testing nginx configuration..."
sudo nginx -t

# Reload nginx
echo "Reloading nginx..."
sudo systemctl reload nginx

# Check if nginx is running
sudo systemctl status nginx --no-pager | head -5

echo ""
echo "=== Nginx SSL Configuration Fixed ==="
echo "Testing connection..."

# Test local connection
curl -k -I https://localhost/ 2>&1 | head -5 || echo "Note: Local test may fail if app isn't running"

echo ""
echo "✅ Configuration complete!"
echo "Site should be accessible at: https://academyfirstaid.hackohackob.com"
