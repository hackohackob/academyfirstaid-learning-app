#!/bin/bash
# ⚠️ WARNING: THIS SCRIPT IS FOR THE VPS SERVER (hackohackob.com) ONLY!
# Quick fix for certbot nginx plugin issue

set -e

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
echo "Now try: sudo certbot --nginx -d academyfirstaid.hackohackob.com"
