#!/bin/bash
# Upload and run the fix script on the VPS

HOST="hacko@hackohackob.com"
SCRIPT="deploy/complete-fix-oneliner.sh"

echo "Uploading fix script to server..."
scp "$SCRIPT" "$HOST:/tmp/fix.sh"

echo ""
echo "Running fix script on server..."
echo "You will be prompted for the password: Somedeveloper1"
ssh "$HOST" "chmod +x /tmp/fix.sh && /tmp/fix.sh"

echo ""
echo "✅ Done! Check the output above for results."
