#!/bin/bash
# ⚠️ WARNING: THIS SCRIPT IS FOR THE VPS SERVER (hackohackob.com) ONLY!
# DO NOT RUN THIS ON YOUR LOCAL MACHINE!
# This script should be uploaded to and run on the remote server.

set -e

echo "=== Complete Server Setup After Factory Reset ==="

# Update system
echo "Updating system packages..."
sudo apt-get update
sudo apt-get upgrade -y

# Install essential tools
echo "Installing essential tools..."
sudo apt-get install -y \
    curl \
    wget \
    git \
    vim \
    ufw \
    software-properties-common

# Install Docker
echo "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://get.docker.com -o get-docker.sh
    sudo sh get-docker.sh
    sudo usermod -aG docker $USER
    rm get-docker.sh
    echo "Docker installed. You may need to log out and back in for group changes."
else
    echo "Docker already installed."
fi

# Install Docker Compose
echo "Installing Docker Compose..."
if ! command -v docker-compose &> /dev/null; then
    sudo curl -L "https://github.com/docker/compose/releases/latest/download/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
    sudo chmod +x /usr/local/bin/docker-compose
else
    echo "Docker Compose already installed."
fi

# Install Nginx
echo "Installing Nginx..."
if ! command -v nginx &> /dev/null; then
    sudo apt-get install -y nginx
else
    echo "Nginx already installed."
fi

# Install Certbot with nginx plugin
echo "Installing Certbot with nginx plugin..."
sudo apt-get install -y certbot python3-certbot-nginx python3-pip
# Ensure nginx plugin is available
sudo pip3 install --upgrade certbot-nginx 2>/dev/null || true

# Setup firewall
echo "Configuring firewall..."
sudo ufw --force enable
sudo ufw allow 22/tcp
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

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
sudo systemctl restart nginx
sudo systemctl enable nginx
sudo systemctl restart docker
sudo systemctl enable docker

cd $APP_DIR
echo "Note: Docker image will be pulled on first deployment via GitHub Actions"

echo ""
echo "=== Setup Complete ==="
echo ""
echo "Application directory: $APP_DIR"
echo ""
echo "Next steps:"
echo "1. Setup SSL: sudo certbot --nginx -d academyfirstaid.hackohackob.com"
echo "2. Copy questions: scp questions/*.csv hacko@hackohackob.com:$APP_DIR/questions/"
echo "3. Add GitHub secret DOCKER_PASSWORD: 123456!!123"
echo "4. Push to GitHub to trigger deployment"
