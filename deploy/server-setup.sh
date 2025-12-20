#!/bin/bash
# ⚠️ WARNING: THIS SCRIPT IS FOR THE VPS SERVER (hackohackob.com) ONLY!
# DO NOT RUN THIS ON YOUR LOCAL MACHINE!
# This script should be uploaded to and run on the remote server.

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

echo ""
echo "=== Updating System ==="
sudo apt-get update
sudo apt-get upgrade -y

echo ""
echo "=== Installing Dependencies ==="

# Install Docker
if ! command -v docker &> /dev/null; then
    echo "Installing Docker..."
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "Docker installed. You may need to log out and back in for group changes to take effect."
fi

# Install Docker Compose
if ! command -v docker-compose &> /dev/null; then
    echo "Installing Docker Compose..."
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
fi

# Install Nginx
if ! command -v nginx &> /dev/null; then
    echo "Installing Nginx..."
    sudo apt-get install -y nginx
fi

# Install Certbot for SSL
if ! command -v certbot &> /dev/null; then
    echo "Installing Certbot..."
    sudo apt-get install -y certbot python3-certbot-nginx
fi

echo ""
echo "=== Setting Up Application ==="

# Create application directory
APP_DIR="/opt/academyfirstaid"
echo "Creating application directory at $APP_DIR..."
sudo mkdir -p $APP_DIR
sudo mkdir -p $APP_DIR/questions
sudo mkdir -p $APP_DIR/flashcards-app/data
sudo chown -R $USER:$USER $APP_DIR

# Create docker-compose.yml
echo "Creating docker-compose.yml..."
cat > $APP_DIR/docker-compose.yml << 'EOF'
version: '3.8'

services:
  app:
    image: hackohackob/academyfirstaid:latest
    container_name: academyfirstaid-app
    restart: unless-stopped
    ports:
      - "127.0.0.1:3000:3000"
    volumes:
      - ./flashcards-app/data:/app/flashcards-app/data
      - ./questions:/app/questions:ro
    environment:
      - PORT=3000
      - NODE_ENV=production
    healthcheck:
      test: ["CMD", "curl", "-f", "http://localhost:3000/api/decks"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 40s
EOF

# Setup Nginx configuration
echo "Setting up Nginx configuration..."
sudo tee /etc/nginx/sites-available/academyfirstaid > /dev/null << 'EOF'
server {
    listen 80;
    listen [::]:80;
    server_name academyfirstaid.hackohackob.com;

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
EOF

# Enable site
sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test nginx configuration
echo "Testing Nginx configuration..."
sudo nginx -t

# Start services
echo "Starting services..."
cd $APP_DIR
docker-compose pull || echo "Note: Docker image not yet available. It will be pulled on first deployment."
docker-compose up -d || echo "Note: Container will start once image is available."
sudo systemctl restart nginx
sudo systemctl enable nginx

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Application directory: $APP_DIR"
echo ""
echo "Next steps:"
echo "1. Setup SSL certificate: sudo certbot --nginx -d academyfirstaid.hackohackob.com"
echo "2. After SSL is configured, update nginx config with SSL settings"
echo "3. Copy questions CSV files to $APP_DIR/questions/"
echo "4. View logs: cd $APP_DIR && docker-compose logs -f"
echo "5. Restart: cd $APP_DIR && docker-compose restart"
