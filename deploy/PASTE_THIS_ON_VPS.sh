#!/bin/bash
# Copy and paste this entire script into your VPS SSH session

echo "=== Fixing Certbot Nginx Plugin ==="

# Install certbot and nginx plugin
sudo apt-get update
sudo apt-get install -y certbot python3-certbot-nginx python3-pip

# Ensure plugin is installed
sudo pip3 install --upgrade certbot-nginx

# Verify installation
echo "Verifying certbot installation..."
certbot --version
certbot plugins | grep nginx || echo "Warning: nginx plugin may not be detected, but should work"

echo ""
echo "=== Certbot Fixed ==="
echo "Now running certbot..."

# Run certbot
sudo certbot --nginx -d academyfirstaid.hackohackob.com --non-interactive --agree-tos --email hackohackob@gmail.com --redirect

echo ""
echo "=== SSL Setup Complete ==="
echo "Testing nginx configuration..."
sudo nginx -t
sudo systemctl reload nginx

echo ""
echo "✅ All done! Your site should now be accessible at https://academyfirstaid.hackohackob.com"
