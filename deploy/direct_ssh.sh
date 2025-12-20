#!/bin/bash
# Direct SSH execution - encodes script and runs it remotely

HOST="hacko@hackohackob.com"
PASSWORD="Somedeveloper1"
SCRIPT_FILE="deploy/fix-certbot.sh"

echo "Encoding and uploading script..."

# Encode the script
ENCODED=$(base64 < "$SCRIPT_FILE")

# Create a command that decodes and runs the script
REMOTE_CMD="echo '$ENCODED' | base64 -d > /tmp/fix-certbot.sh && chmod +x /tmp/fix-certbot.sh && /tmp/fix-certbot.sh"

# Try to use ssh with password via expect
expect << EOF
set timeout 120
spawn ssh -o StrictHostKeyChecking=no $HOST "$REMOTE_CMD"
expect {
    "password:" { send "$PASSWORD\r"; exp_continue }
    "Password:" { send "$PASSWORD\r"; exp_continue }
    eof
}
wait
EOF

echo ""
echo "Script execution complete. Checking certbot installation..."
echo ""

# Now try certbot
expect << EOF
set timeout 120
spawn ssh -o StrictHostKeyChecking=no $HOST "sudo certbot --nginx -d academyfirstaid.hackohackob.com --non-interactive --agree-tos --email hackohackob@gmail.com --redirect"
expect {
    "password:" { send "$PASSWORD\r"; exp_continue }
    "Password:" { send "$PASSWORD\r"; exp_continue }
    "sudo.*password" { send "$PASSWORD\r"; exp_continue }
    eof
}
wait
EOF
