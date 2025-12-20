#!/bin/bash
set -e

echo "=== Resetting Server to Factory Settings ==="

# Stop all containers
echo "Stopping all Docker containers..."
docker stop $(docker ps -aq) 2>/dev/null || true
docker rm $(docker ps -aq) 2>/dev/null || true

# Remove all images
echo "Removing all Docker images..."
docker rmi $(docker images -q) 2>/dev/null || true

# Prune system
echo "Pruning Docker system..."
docker system prune -af --volumes

# Stop and disable nginx
echo "Stopping Nginx..."
sudo systemctl stop nginx 2>/dev/null || true
sudo systemctl disable nginx 2>/dev/null || true

# Remove nginx configurations
echo "Removing Nginx configurations..."
sudo rm -f /etc/nginx/sites-enabled/academyfirstaid
sudo rm -f /etc/nginx/sites-available/academyfirstaid
sudo rm -f /etc/nginx/sites-enabled/default

# Remove application directory
echo "Removing application directory..."
sudo rm -rf /opt/academyfirstaid

# Clean up
echo "Cleaning up..."
sudo apt-get autoremove -y
sudo apt-get autoclean -y

echo ""
echo "=== Server Reset Complete ==="
echo "Server has been reset to factory settings."
echo "Run setup-server.sh to set up the application again."
