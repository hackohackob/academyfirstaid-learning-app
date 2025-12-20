# ⚠️ IMPORTANT: VPS Server Setup Instructions

## ⚠️ CRITICAL WARNING

**ALL SCRIPTS IN THIS DIRECTORY ARE FOR THE VPS SERVER (hackohackob.com) ONLY!**

**DO NOT RUN THESE SCRIPTS ON YOUR LOCAL MACHINE!**

These scripts will:
- Remove Docker containers and images
- Remove applications and data
- Modify system configurations
- **ONLY run them on the remote VPS server**

---

## How to Reset and Setup Your VPS

### Step 1: Upload Factory Reset Script to VPS

**Run this on your LOCAL machine:**

```bash
# Upload the reset script to the VPS
scp deploy/factory-reset.sh hacko@hackohackob.com:/tmp/factory-reset.sh
```

### Step 2: Connect to VPS and Run Reset

**Run this on your LOCAL machine to connect:**

```bash
ssh hacko@hackohackob.com
# Password: Somedeveloper1
```

**Then on the VPS, run:**

```bash
chmod +x /tmp/factory-reset.sh
/tmp/factory-reset.sh
# Type "yes" when prompted
```

This will completely reset the VPS to factory settings.

### Step 3: Upload Setup Script to VPS

**On your LOCAL machine (in a new terminal, or after exiting SSH):**

```bash
scp deploy/complete-setup.sh hacko@hackohackob.com:/tmp/complete-setup.sh
```

### Step 4: Connect to VPS and Run Setup

**Connect to VPS again:**

```bash
ssh hacko@hackohackob.com
```

**Then on the VPS, run:**

```bash
chmod +x /tmp/complete-setup.sh
/tmp/complete-setup.sh
```

This will install Docker, nginx, and configure everything.

---

## Quick Reference

### Commands to Run on LOCAL Machine:

```bash
# 1. Upload reset script
scp deploy/factory-reset.sh hacko@hackohackob.com:/tmp/

# 2. Upload setup script (after reset)
scp deploy/complete-setup.sh hacko@hackohackob.com:/tmp/

# 3. Copy questions files (after setup)
scp questions/*.csv hacko@hackohackob.com:/opt/academyfirstaid/questions/
```

### Commands to Run on VPS (after SSH):

```bash
# 1. Run factory reset
chmod +x /tmp/factory-reset.sh
/tmp/factory-reset.sh

# 2. Run complete setup
chmod +x /tmp/complete-setup.sh
/tmp/complete-setup.sh

# 3. Setup SSL
sudo certbot --nginx -d academyfirstaid.hackohackob.com
```

---

## What Gets Reset on VPS

✅ **Removed from VPS:**
- All Docker containers, images, volumes
- nginx and configurations
- Docker and Docker Compose
- All application data
- All user files in /home/hacko

✅ **Preserved on VPS:**
- hacko user account
- root user account
- Base OS and system packages
- Network configuration
- SSH access

✅ **Your Local Machine:**
- **NOT AFFECTED AT ALL**
- All your local files remain untouched
- Only the remote VPS is reset

---

## Verification

After setup, verify on the VPS:

```bash
# Check Docker
docker --version
docker-compose --version

# Check nginx
sudo systemctl status nginx

# Check application directory
ls -la /opt/academyfirstaid
```

---

## Need Help?

If something goes wrong:
1. The VPS can be reset again using the factory-reset.sh script
2. Your local machine is never affected
3. All scripts are designed to be run on the remote VPS only
