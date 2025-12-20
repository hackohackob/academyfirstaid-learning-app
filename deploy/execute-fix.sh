#!/usr/bin/expect -f

set timeout 300
set password "Somedeveloper1"
set host "hacko@hackohackob.com"

# The complete fix command
set fix_cmd {
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
sudo ln -sf /etc/nginx/sites-available/academyfirstaid /etc/nginx/sites-enabled/academyfirstaid && sudo nginx -t && sudo systemctl reload nginx && cd /opt/academyfirstaid && docker-compose up -d && sleep 5 && curl -s -o /dev/null -w "HTTP Status: %{http_code}\n" https://academyfirstaid.hackohackob.com/ && echo "✅ Site is working!" || echo "⚠️  Check logs"
}

spawn ssh -o StrictHostKeyChecking=no $host "bash -c {$fix_cmd}"

expect {
    -re "password:" {
        send "$password\r"
        exp_continue
    }
    -re "Password:" {
        send "$password\r"
        exp_continue
    }
    -re "sudo.*password" {
        send "$password\r"
        exp_continue
    }
    eof
}

wait

# Now test the URL
spawn ssh -o StrictHostKeyChecking=no $host "curl -s -I https://academyfirstaid.hackohackob.com/ | head -10"

expect {
    -re "password:" {
        send "$password\r"
        exp_continue
    }
    -re "Password:" {
        send "$password\r"
        exp_continue
    }
    eof
}

wait
