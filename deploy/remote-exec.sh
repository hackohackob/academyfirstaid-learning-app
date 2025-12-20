#!/usr/bin/expect -f

set timeout 60
set password "Somedeveloper1"
set host "hacko@hackohackob.com"
set script_path [lindex $argv 0]

if {[llength $argv] < 1} {
    puts "Usage: $argv0 <script_to_upload_and_run>"
    exit 1
}

# Upload the script
spawn scp -o StrictHostKeyChecking=no $script_path $host:/tmp/[file tail $script_path]

expect {
    "password:" {
        send "$password\r"
        exp_continue
    }
    "Password:" {
        send "$password\r"
        exp_continue
    }
    eof {
        # Upload complete
    }
    timeout {
        puts "Upload timeout"
        exit 1
    }
}

wait

# Run the script
set script_name [file tail $script_path]
spawn ssh -o StrictHostKeyChecking=no $host "chmod +x /tmp/$script_name && /tmp/$script_name"

expect {
    "password:" {
        send "$password\r"
        exp_continue
    }
    "Password:" {
        send "$password\r"
        exp_continue
    }
    eof {
        # Script complete
    }
    timeout {
        puts "Execution timeout"
        exit 1
    }
}

wait
