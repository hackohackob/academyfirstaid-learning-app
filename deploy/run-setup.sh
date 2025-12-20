#!/bin/bash
# This script uploads and runs the setup on the remote server

HOST="hacko@hackohackob.com"
SCRIPT="deploy/server-setup.sh"

echo "Uploading setup script to server..."
scp "$SCRIPT" "$HOST:/tmp/server-setup.sh"

echo "Running setup script on server..."
echo "You will be prompted for the password: Somedeveloper1"
ssh "$HOST" "chmod +x /tmp/server-setup.sh && /tmp/server-setup.sh"

echo "Setup complete!"
