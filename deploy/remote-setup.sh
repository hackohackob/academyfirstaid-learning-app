#!/usr/bin/expect -f

set timeout 300
set password "Somedeveloper1"
set host "hacko@hackohackob.com"

spawn ssh -o StrictHostKeyChecking=no $host

expect {
    "password:" {
        send "$password\r"
        exp_continue
    }
    "Password:" {
        send "$password\r"
        exp_continue
    }
    "$ " {
        send "bash -s\r"
        exp_continue
    }
    "# " {
        send "bash -s\r"
        exp_continue
    }
    "EOF" {
        # Script will be sent via stdin
    }
}

# Send the setup script
send "cat > /tmp/setup-remote.sh << 'REMOTE_EOF'\r"
send "#!/bin/bash\r"
send "set -e\r"
send "echo '=== Resetting Server ==='\r"
send "docker stop \$(docker ps -aq) 2>/dev/null || true\r"
send "docker rm \$(docker ps -aq) 2>/dev/null || true\r"
send "docker rmi \$(docker images -q) 2>/dev/null || true\r"
send "docker system prune -af --volumes\r"
send "sudo systemctl stop nginx 2>/dev/null || true\r"
send "sudo rm -f /etc/nginx/sites-enabled/academyfirstaid\r"
send "sudo rm -f /etc/nginx/sites-available/academyfirstaid\r"
send "sudo rm -rf /opt/academyfirstaid\r"
send "echo '=== Installing Dependencies ==='\r"
send "sudo apt-get update\r"
send "sudo apt-get upgrade -y\r"
send "if ! command -v docker &> /dev/null; then curl -fsSL https://get.docker.com | sudo sh; sudo usermod -aG docker \$USER; fi\r"
send "if ! command -v docker-compose &> /dev/null; then sudo curl -L \"https://github.com/docker/compose/releases/latest/download/docker-compose-\$(uname -s)-\$(uname -m)\" -o /usr/local/bin/docker-compose; sudo chmod +x /usr/local/bin/docker-compose; fi\r"
send "sudo apt-get install -y nginx certbot python3-certbot-nginx\r"
send "echo '=== Setting Up Application ==='\r"
send "sudo mkdir -p /opt/academyfirstaid/flashcards-app/data /opt/academyfirstaid/questions\r"
send "sudo chown -R \$USER:\$USER /opt/academyfirstaid\r"
send "cat > /opt/academyfirstaid/docker-compose.yml << 'EOF'\r"
send "version: '3.8'\r"
send "services:\r"
send "  app:\r"
send "    image: hackohackob/academyfirstaid:latest\r"
send "    container_name: academyfirstaid-app\r"
send "    restart: unless-stopped\r"
send "    ports:\r"
send "      - \"127.0.0.1:3000:3000\"\r"
send "    volumes:\r"
send "      - ./flashcards-app/data:/app/flashcards-app/data\r"
send "      - ./questions:/app/questions:ro\r"
send "    environment:\r"
send "      - PORT=3000\r"
send "      - NODE_ENV=production\r"
send "    healthcheck:\r"
send "      test: [\"CMD\", \"curl\", \"-f\", \"http://localhost:3000/api/decks\"]\r"
send "      interval: 30s\r"
send "      timeout: 10s\r"
send "      retries: 3\r"
send "      start_period: 40s\r"
send "EOF\r"
send "sudo tee /etc/nginx/sites-available/academyfirstaid > /dev/null << 'NGINX_EOF'\r"
send "server {\r"
send "    listen 80;\r"
send "    server_name academyfirstaid.hackohackob.com;\r"
send "    location / {\r"
send "        proxy_pass http://127.0.0.1:3000;\r"
send "        proxy_http_version 1.1;\r"
send "        proxy_set_header Upgrade \$http_upgrade;\r"
send "        proxy_set_header Connection 'upgrade';\r"
send "        proxy_set_header Host \$host;\r"
send "        proxy_set_header X-Real-IP \$remote_addr;\r"
send "        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;\r"
send "        proxy_set_header X-Forwarded-Proto \$scheme;\r"
send "        proxy_cache_bypass \$http_upgrade;\r"
send "    }\r"
send "    client_max_body_size 10M;\r"
send "}\r"
send "NGINX_EOF\r"
send "sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/\r"
send "sudo rm -f /etc/nginx/sites-enabled/default\r"
send "sudo nginx -t\r"
send "sudo systemctl restart nginx\r"
send "sudo systemctl enable nginx\r"
send "echo '=== Setup Complete ==='\r"
send "echo 'Run: sudo certbot --nginx -d academyfirstaid.hackohackob.com'\r"
send "REMOTE_EOF\r"
send "chmod +x /tmp/setup-remote.sh\r"
send "/tmp/setup-remote.sh\r"

expect {
    "password:" {
        send "$password\r"
        exp_continue
    }
    "$ " {
        send "exit\r"
    }
    "# " {
        send "exit\r"
    }
}

interact
