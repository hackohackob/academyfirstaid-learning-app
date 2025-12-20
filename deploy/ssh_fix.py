#!/usr/bin/env python3
import subprocess
import sys
import os

def run_ssh_command(host, password, command):
    """Run SSH command using pexpect if available, otherwise provide instructions"""
    try:
        import pexpect
        child = pexpect.spawn(f'ssh -o StrictHostKeyChecking=no {host} "{command}"', timeout=300)
        child.expect(['password:', 'Password:'], timeout=10)
        child.sendline(password)
        child.expect(pexpect.EOF, timeout=300)
        output = child.before.decode('utf-8')
        child.close()
        return child.exitstatus == 0, output
    except ImportError:
        print("pexpect not available. Installing...")
        subprocess.run([sys.executable, '-m', 'pip', 'install', '--user', 'pexpect'], check=False)
        try:
            import pexpect
            child = pexpect.spawn(f'ssh -o StrictHostKeyChecking=no {host} "{command}"', timeout=300)
            child.expect(['password:', 'Password:'], timeout=10)
            child.sendline(password)
            child.expect(pexpect.EOF, timeout=300)
            output = child.before.decode('utf-8')
            child.close()
            return child.exitstatus == 0, output
        except Exception as e:
            return False, str(e)
    except Exception as e:
        return False, str(e)

def main():
    host = "hacko@hackohackob.com"
    password = "Somedeveloper1"
    
    # Read the fix script
    script_path = "deploy/complete-fix-and-test.sh"
    if not os.path.exists(script_path):
        print(f"Error: Script not found: {script_path}")
        sys.exit(1)
    
    with open(script_path, 'r') as f:
        script_content = f.read()
    
    print("Uploading and running fix script on server...")
    print("=" * 60)
    
    # Upload script
    upload_cmd = f"cat > /tmp/fix.sh << 'SCRIPT_EOF'\n{script_content}\nSCRIPT_EOF\nchmod +x /tmp/fix.sh"
    success, output = run_ssh_command(host, password, upload_cmd)
    
    if not success:
        print(f"Upload failed: {output}")
        sys.exit(1)
    
    print("Script uploaded. Running fix script...")
    print("=" * 60)
    
    # Run the script
    run_cmd = "/tmp/fix.sh"
    success, output = run_ssh_command(host, password, run_cmd)
    
    print(output)
    
    if success:
        print("\n" + "=" * 60)
        print("✅ Fix script completed!")
        
        # Test the URL
        print("\nTesting URL...")
        test_cmd = "curl -s -I https://academyfirstaid.hackohackob.com/ | head -5"
        success, output = run_ssh_command(host, password, test_cmd)
        print(output)
    else:
        print(f"\n❌ Script failed: {output}")
        sys.exit(1)

if __name__ == "__main__":
    main()
