#!/usr/bin/env python3
import subprocess
import sys
import os

def run_command(cmd, input_text=None):
    """Run a command and return output"""
    try:
        process = subprocess.Popen(
            cmd,
            shell=True,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )
        stdout, stderr = process.communicate(input=input_text)
        return process.returncode, stdout, stderr
    except Exception as e:
        return 1, "", str(e)

def main():
    host = "hacko@hackohackob.com"
    password = "Somedeveloper1"
    script_path = "deploy/fix-certbot.sh"
    
    if not os.path.exists(script_path):
        print(f"Error: Script not found: {script_path}")
        sys.exit(1)
    
    print("Uploading fix-certbot.sh to server...")
    
    # Try using sshpass if available
    scp_cmd = f'sshpass -p "{password}" scp -o StrictHostKeyChecking=no {script_path} {host}:/tmp/fix-certbot.sh'
    code, stdout, stderr = run_command(scp_cmd)
    
    if code != 0:
        print(f"Upload failed. Trying alternative method...")
        print(f"Error: {stderr}")
        print("\nPlease run manually:")
        print(f"scp {script_path} {host}:/tmp/")
        sys.exit(1)
    
    print("Upload successful!")
    print("\nRunning fix-certbot.sh on server...")
    
    # Run the script
    ssh_cmd = f'sshpass -p "{password}" ssh -o StrictHostKeyChecking=no {host} "chmod +x /tmp/fix-certbot.sh && /tmp/fix-certbot.sh"'
    code, stdout, stderr = run_command(ssh_cmd)
    
    print(stdout)
    if stderr:
        print("Errors:", stderr, file=sys.stderr)
    
    if code == 0:
        print("\n✅ Fix script completed successfully!")
        print("\nNow running certbot...")
        
        certbot_cmd = f'sshpass -p "{password}" ssh -o StrictHostKeyChecking=no {host} "echo {password} | sudo -S certbot --nginx -d academyfirstaid.hackohackob.com --non-interactive --agree-tos --email hackohackob@gmail.com --redirect"'
        code, stdout, stderr = run_command(certbot_cmd)
        
        print(stdout)
        if stderr:
            print("Certbot output:", stderr)
    else:
        print(f"\n❌ Script failed with code {code}")
        sys.exit(1)

if __name__ == "__main__":
    main()
