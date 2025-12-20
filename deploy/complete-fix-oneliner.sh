sudo mkdir -p /opt/academyfirstaid/flashcards-app/data /opt/academyfirstaid/questions && sudo chown -R $USER:$USER /opt/academyfirstaid && cat > /opt/academyfirstaid/docker-compose.yml << 'COMPOSE_EOF'
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
COMPOSE_EOF
sudo rm -f /etc/nginx/sites-enabled/default && sudo tee /etc/nginx/sites-available/academyfirstaid > /dev/null << 'NGINX_EOF'
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
    }
    client_max_body_size 10M;
}
NGINX_EOF
sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/academyfirstaid && sudo nginx -t && sudo systemctl reload nginx && sudo usermod -aG docker $USER && cd /opt/academyfirstaid && (sudo docker-compose up -d || newgrp docker << 'DOCKER_CMD'
cd /opt/academyfirstaid
docker-compose up -d
sleep 5
curl -s -I https://academyfirstaid.hackohackob.com/ | head -10
echo "✅ Site is working!"
DOCKER_CMD
)
