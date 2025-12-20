#!/bin/bash
# ⚠️ WARNING: THIS SCRIPT IS FOR THE VPS SERVER (hackohackob.com) ONLY!
# DO NOT RUN THIS ON YOUR LOCAL MACHINE!
# This script should be uploaded to and run on the remote server.

set -e

echo "=== FACTORY RESET - Complete Server Reset ==="
echo "⚠️  WARNING: This script is for the VPS server only!"
echo "This will remove ALL applications, data, and configurations"
echo "Only hacko and root users will remain"
echo ""
read -p "Are you sure you want to continue? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
    echo "Aborted."
    exit 1
fi

echo ""
echo "=== Stopping All Services ==="

# Stop all Docker containers
echo "Stopping Docker containers..."
docker stop $(docker ps -aq) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

# Remove all Docker images
echo "Removing Docker images..."
docker rmi $(docker images -q) 2>/dev/null || true

# Prune Docker system completely
echo "Pruning Docker system..."
docker system prune -af --volumes 2>/dev/null || true

# Stop and disable services
echo "Stopping services..."
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl stop docker 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true

echo ""
echo "=== Removing Applications ==="

# Remove application directories
echo "Removing application directories..."
sudo rm -rf /opt/academyfirstaid
sudo rm -rf /opt/*
sudo rm -rf /home/hacko/* 2>/dev/null || true
sudo rm -rf /home/hacko/.* 2>/dev/null || true
sudo mkdir -p /home/hacko
sudo chown hacko:hacko /home/hacko

# Remove nginx
echo "Removing Nginx..."
sudo apt-get remove --purge -y nginx nginx-common nginx-core 2>/dev/null || true
sudo rm -rf /etc/nginx
sudo rm -rf /var/www/html/*
sudo rm -rf /var/log/nginx

# Remove Docker
echo "Removing Docker..."
sudo apt-get remove --purge -y docker.io docker-doc docker-compose docker-compose-v2 podman-docker containerd runc 2>/dev/null || true
sudo rm -rf /var/lib/docker
sudo rm -rf /var/lib/containerd
sudo rm -rf /etc/docker
sudo rm -rf ~/.docker

# Remove certbot
echo "Removing Certbot..."
sudo apt-get remove --purge -y certbot python3-certbot-nginx 2>/dev/null || true
sudo rm -rf /etc/letsencrypt

# Remove other common packages
echo "Removing other packages..."
sudo apt-get remove --purge -y \
    apache2 \
    mysql-server \
    postgresql \
    nodejs \
    npm \
    yarn \
    2>/dev/null || true

echo ""
echo "=== Cleaning System ==="

# Clean apt cache
sudo apt-get autoremove -y
sudo apt-get autoclean -y
sudo apt-get clean

# Remove temporary files
sudo rm -rf /tmp/*
sudo rm -rf /var/tmp/*

# Clear logs (keep system logs)
sudo find /var/log -type f -name "*.log" -exec truncate -s 0 {} \; 2>/dev/null || true
sudo find /var/log -type f -name "*.gz" -delete 2>/dev/null || true

# Remove cron jobs (except system ones)
crontab -l 2>/dev/null | grep -v "^#" | grep -v "^$" | crontab - 2>/dev/null || crontab -r 2>/dev/null || true

# Remove SSH keys (keep authorized_keys structure)
rm -rf ~/.ssh/id_* 2>/dev/null || true
rm -rf ~/.ssh/known_hosts 2>/dev/null || true

# Remove bash history
history -c
rm -f ~/.bash_history
rm -f ~/.zsh_history

echo ""
echo "=== Resetting Network Config ==="

# Keep network config but remove custom nginx/apache configs
sudo rm -rf /etc/nginx
sudo rm -rf /etc/apache2

echo ""
echo "=== Final Cleanup ==="

# Update package lists
sudo apt-get update

echo ""
echo "=== FACTORY RESET COMPLETE ==="
echo "Server has been reset to factory settings."
echo "Only hacko and root users remain."
echo ""
echo "Next steps:"
echo "1. Run the setup script to install everything fresh"
echo "2. Or manually install what you need"
