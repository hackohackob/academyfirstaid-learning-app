#!/usr/bin/expect -f

set timeout 120
set password "Somedeveloper1"
set host "hacko@hackohackob.com"

# First, upload the script
spawn scp -o StrictHostKeyChecking=no deploy/fix-certbot.sh $host:/tmp/fix-certbot.sh

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

# Wait for upload to complete
wait

# Now run the script
spawn ssh -o StrictHostKeyChecking=no $host "chmod +x /tmp/fix-certbot.sh && /tmp/fix-certbot.sh"

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

# Wait for execution to complete
wait

# Now try certbot
spawn ssh -o StrictHostKeyChecking=no $host "sudo certbot --nginx -d academyfirstaid.hackohackob.com --non-interactive --agree-tos --email hackohackob@gmail.com --redirect"

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
