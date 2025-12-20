#!/usr/bin/expect -f

set timeout 300
set password "Somedeveloper1"
set host "hacko@hackohackob.com"

# Read the fix script
set script_file "deploy/complete-fix-and-test.sh"
set fp [open $script_file r]
set script_content [read $fp]
close $fp

# Execute the script remotely
spawn ssh -o StrictHostKeyChecking=no $host "bash -s"

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
        send "$script_content\r"
        send "exit\r"
        exp_continue
    }
    "# " {
        send "$script_content\r"
        send "exit\r"
        exp_continue
    }
    eof
}

wait

# Now test the URL
spawn ssh -o StrictHostKeyChecking=no $host "curl -s -o /dev/null -w 'HTTP Status: %{http_code}\n' https://academyfirstaid.hackohackob.com/ && echo '✅ Site is accessible!' || echo '❌ Site not accessible'"

expect {
    "password:" {
        send "$password\r"
        exp_continue
    }
    "Password:" {
        send "$password\r"
        exp_continue
    }
    eof
}

wait
