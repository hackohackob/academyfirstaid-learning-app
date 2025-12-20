# Complete Server Reset and Setup

## ⚠️ CRITICAL WARNING

**ALL SCRIPTS IN THIS GUIDE ARE FOR THE VPS SERVER (hackohackob.com) ONLY!**

**DO NOT RUN THESE SCRIPTS ON YOUR LOCAL MACHINE!**

You will upload these scripts to the VPS and run them there.

---

This guide will completely reset your **VPS** to factory settings and then set up the Academy First Aid application.

## ⚠️ What the Factory Reset Does

The factory reset script will (ONLY on the VPS):
- Remove ALL Docker containers, images, and volumes
- Remove ALL applications and data
- Remove nginx, Docker, and other packages
- Clear logs and temporary files
- **ONLY preserve hacko and root users**

## Step 1: Factory Reset

### Option A: Run Remotely (Recommended)

```bash
# Upload reset script
scp deploy/factory-reset.sh hacko@hackohackob.com:/tmp/

# Connect to server
ssh hacko@hackohackob.com
# Password: Somedeveloper1

# Run factory reset
chmod +x /tmp/factory-reset.sh
/tmp/factory-reset.sh
# Type "yes" when prompted
```

### Option B: Copy and Paste

If SCP doesn't work, you can copy the contents of `deploy/factory-reset.sh` and paste it directly into your SSH session.

## Step 2: Complete Setup

After the factory reset completes:

```bash
# Upload setup script
scp deploy/complete-setup.sh hacko@hackohackob.com:/tmp/

# Run setup
chmod +x /tmp/complete-setup.sh
/tmp/complete-setup.sh
```

Or copy and paste the contents of `deploy/complete-setup.sh`.

## Step 3: Configure GitHub Secrets

1. Go to your GitHub repository: https://github.com/hackohackob/academyfirstaid-learning-app
2. Navigate to: Settings → Secrets and variables → Actions
3. Add/Update the following secret:
   - **Name**: `DOCKER_PASSWORD`
   - **Value**: `123456!!123`

The Docker username (`hackohackob@gmail.com`) is already configured in the workflow file.

## Step 4: Setup SSL Certificate

```bash
ssh hacko@hackohackob.com
sudo certbot --nginx -d academyfirstaid.hackohackob.com
```

Follow the prompts to complete SSL setup.

## Step 5: Copy Questions Files

```bash
# From your local machine
scp questions/*.csv hacko@hackohackob.com:/opt/academyfirstaid/questions/
```

## Step 6: Deploy Application

### Option A: Via GitHub Actions (Recommended)

1. Push your code to GitHub:
   ```bash
   git add .
   git commit -m "Initial deployment setup"
   git push origin master
   ```

2. GitHub Actions will automatically:
   - Build Docker image
   - Push to Docker Hub
   - Deploy to server

### Option B: Manual Deployment

```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose pull
docker-compose up -d
```

## Verification

After deployment, verify everything is working:

```bash
ssh hacko@hackohackob.com

# Check Docker container
docker ps

# Check logs
cd /opt/academyfirstaid
docker-compose logs -f

# Check nginx
sudo systemctl status nginx

# Test application
curl http://localhost:3000/api/decks
```

## Troubleshooting

### Docker not working after reset
```bash
# Re-add user to docker group
sudo usermod -aG docker $USER
# Log out and back in, or:
newgrp docker
```

### nginx not starting
```bash
sudo nginx -t
sudo systemctl status nginx
sudo journalctl -u nginx -f
```

### Container not starting
```bash
cd /opt/academyfirstaid
docker-compose logs app
docker-compose up -d
```

## What Gets Reset

✅ **Removed:**
- All Docker containers, images, volumes
- nginx and all configurations
- Docker and Docker Compose
- Certbot and SSL certificates
- All application data in /opt
- All user files in /home/hacko
- Package caches and temporary files
- Logs (system logs preserved)

✅ **Preserved:**
- hacko user account
- root user account
- System packages (base OS)
- Network configuration
- SSH access

## After Reset

The server will be like a fresh VPS installation with:
- Only base OS packages
- hacko and root users
- SSH access configured
- Ready for fresh application installation
