# Server Deployment Guide

This guide will help you set up the Academy First Aid application on your VPS.

## Prerequisites

- VPS running Ubuntu/Debian
- SSH access to the server (hacko@hackohackob.com)
- Domain name configured: academyfirstaid.hackohackob.com

## Quick Setup

### Step 1: Connect to Server

```bash
ssh hacko@hackohackob.com
# Password: Somedeveloper1
```

### Step 2: Upload and Run Setup Script

From your local machine:

```bash
# Copy the setup script to the server
scp deploy/server-setup.sh hacko@hackohackob.com:/tmp/

# Connect to server
ssh hacko@hackohackob.com

# Run the setup script
chmod +x /tmp/server-setup.sh
/tmp/server-setup.sh
```

Or, you can copy the contents of `server-setup.sh` and paste it directly into the SSH session.

### Step 3: Setup SSL Certificate

After the setup script completes, run:

```bash
sudo certbot --nginx -d academyfirstaid.hackohackob.com
```

Follow the prompts to complete SSL setup.

### Step 4: Update Nginx Config for SSL

After SSL is set up, update the nginx config with the SSL settings from `nginx/academyfirstaid.conf`:

```bash
sudo nano /etc/nginx/sites-available/academyfirstaid
```

Add the SSL configuration (see `nginx/academyfirstaid.conf` for the full config).

Then test and reload:

```bash
sudo nginx -t
sudo systemctl reload nginx
```

### Step 5: Copy Questions Files

Copy your CSV question files to the server:

```bash
# From your local machine
scp questions/*.csv hacko@hackohackob.com:/opt/academyfirstaid/questions/
```

### Step 6: Configure GitHub Actions

1. Go to your GitHub repository settings
2. Add the following secrets:
   - `DOCKER_USERNAME`: Your Docker Hub username
   - `DOCKER_PASSWORD`: Your Docker Hub password or access token
   - `SSH_PASSWORD`: Your server SSH password (Somedeveloper1)

3. For better security, set up SSH keys instead of password:
   ```bash
   # On your local machine
   ssh-keygen -t ed25519 -f ~/.ssh/github_deploy_key
   
   # Copy public key to server
   ssh-copy-id -i ~/.ssh/github_deploy_key.pub hacko@hackohackob.com
   
   # Add private key to GitHub secrets as SSH_KEY
   ```

## Manual Deployment

If you need to manually deploy:

```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose pull
docker-compose up -d
```

## Viewing Logs

```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose logs -f
```

## Restarting the Application

```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose restart
```

## Troubleshooting

### Docker not starting
- Check if Docker is installed: `docker --version`
- Check Docker service: `sudo systemctl status docker`
- Check logs: `docker-compose logs`

### Nginx not working
- Test config: `sudo nginx -t`
- Check status: `sudo systemctl status nginx`
- View logs: `sudo tail -f /var/log/nginx/error.log`

### Application not accessible
- Check if container is running: `docker ps`
- Check container logs: `docker-compose logs app`
- Verify port binding: `netstat -tlnp | grep 3000`

## Reset Server

To completely reset the server:

```bash
ssh hacko@hackohackob.com
# Run reset script
bash <(curl -s https://raw.githubusercontent.com/your-repo/main/deploy/reset-server.sh)
# Or upload and run locally
scp deploy/reset-server.sh hacko@hackohackob.com:/tmp/
ssh hacko@hackohackob.com
/tmp/reset-server.sh
```
