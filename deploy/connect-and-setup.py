#!/usr/bin/env python3
import subprocess
import sys
import os

def run_ssh_command(host, password, command):
    """Run a command on remote server using SSH with password"""
    ssh_cmd = f'sshpass -p "{password}" ssh -o StrictHostKeyChecking=no {host} "{command}"'
    try:
        result = subprocess.run(ssh_cmd, shell=True, capture_output=True, text=True)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

def scp_file(host, password, local_file, remote_path):
    """Copy file to remote server using SCP with password"""
    scp_cmd = f'sshpass -p "{password}" scp -o StrictHostKeyChecking=no {local_file} {host}:{remote_path}'
    try:
        result = subprocess.run(scp_cmd, shell=True, capture_output=True, text=True)
        return result.returncode == 0, result.stdout, result.stderr
    except Exception as e:
        return False, "", str(e)

if __name__ == "__main__":
    host = "hacko@hackohackob.com"
    password = "Somedeveloper1"
    script_path = os.path.join(os.path.dirname(__file__), "server-setup.sh")
    
    print("Connecting to server and uploading setup script...")
    success, stdout, stderr = scp_file(host, password, script_path, "/tmp/server-setup.sh")
    
    if not success:
        print(f"Failed to upload script: {stderr}")
        print("\nTrying alternative method...")
        # Try direct execution
        with open(script_path, 'r') as f:
            script_content = f.read()
        
        # Escape the script for SSH
        escaped_script = script_content.replace('"', '\\"').replace('$', '\\$').replace('`', '\\`')
        command = f'bash -c "{escaped_script}"'
        success, stdout, stderr = run_ssh_command(host, password, command)
    
    if success:
        print("Setup script uploaded successfully!")
        print("\nRunning setup script on server...")
        success, stdout, stderr = run_ssh_command(host, password, "chmod +x /tmp/server-setup.sh && /tmp/server-setup.sh")
        
        if success:
            print("Setup completed successfully!")
            print(stdout)
        else:
            print(f"Setup failed: {stderr}")
            sys.exit(1)
    else:
        print(f"Failed to connect: {stderr}")
        print("\nPlease run the setup manually:")
        print(f"1. scp {script_path} {host}:/tmp/server-setup.sh")
        print(f"2. ssh {host}")
        print("3. chmod +x /tmp/server-setup.sh && /tmp/server-setup.sh")
        sys.exit(1)
