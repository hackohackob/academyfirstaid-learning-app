# Academy First Aid - Complete Setup Guide

## Overview

This project is a flashcards learning application that will be deployed to `academyfirstaid.hackohackob.com` using Docker, nginx, and automated CI/CD via GitHub Actions.

## Project Structure

```
academyfirstaid/
├── flashcards-app/          # Main application
│   ├── server.js           # Node.js server
│   ├── public/             # Frontend files
│   └── data/               # Database and media (not in git)
├── questions/              # CSV question files (not in git)
├── Dockerfile              # Docker image definition
├── docker-compose.yml     # Production compose file
├── .github/
│   └── workflows/
│       └── deploy.yml      # CI/CD pipeline
└── deploy/                 # Deployment scripts
    ├── server-setup.sh    # Server initialization script
    └── README.md          # Detailed deployment guide
```

## Quick Start - Server Setup

### Option 1: Automated Setup (Recommended)

1. **Upload and run setup script:**
   ```bash
   scp deploy/server-setup.sh hacko@hackohackob.com:/tmp/
   ssh hacko@hackohackob.com
   chmod +x /tmp/server-setup.sh
   /tmp/server-setup.sh
   ```

2. **Setup SSL:**
   ```bash
   sudo certbot --nginx -d academyfirstaid.hackohackob.com
   ```

3. **Copy questions:**
   ```bash
   # From local machine
   scp questions/*.csv hacko@hackohackob.com:/opt/academyfirstaid/questions/
   ```

### Option 2: Manual Setup

See `deploy/README.md` for detailed manual setup instructions.

## GitHub Actions CI/CD Setup

### Required Secrets

Add these secrets to your GitHub repository (Settings → Secrets and variables → Actions):

1. **DOCKER_USERNAME**: Your Docker Hub username
2. **DOCKER_PASSWORD**: Your Docker Hub password or access token
3. **SSH_PASSWORD**: Server SSH password (`Somedeveloper1`)

### How It Works

1. **On push to master/main:**
   - Builds Docker image
   - Pushes to Docker Hub as `hackohackob/academyfirstaid:latest`
   - SSH to server and pulls the new image
   - Restarts the container

2. **Container Management:**
   - Auto-restarts on failure (`restart: unless-stopped`)
   - Health checks every 30 seconds
   - Persistent data in `/opt/academyfirstaid/flashcards-app/data`

## Local Development

### Running Locally

```bash
cd flashcards-app
node server.js
```

Server runs on `http://localhost:3000`

### Building Docker Image Locally

```bash
docker build -t academyfirstaid:local .
docker run -p 3000:3000 -v $(pwd)/questions:/app/questions academyfirstaid:local
```

## Server Management

### View Logs
```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose logs -f
```

### Restart Application
```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose restart
```

### Update Application
```bash
ssh hacko@hackohackob.com
cd /opt/academyfirstaid
docker-compose pull
docker-compose up -d
```

### Reset Server
```bash
ssh hacko@hackohackob.com
# Upload reset script
scp deploy/reset-server.sh hacko@hackohackob.com:/tmp/
ssh hacko@hackohackob.com
/tmp/reset-server.sh
```

## Architecture

- **Frontend**: Static HTML/CSS/JS served by Node.js
- **Backend**: Node.js HTTP server with SQLite database
- **Reverse Proxy**: nginx handles SSL and proxies to Node.js
- **Containerization**: Docker for consistent deployment
- **CI/CD**: GitHub Actions automates build and deployment

## Default Credentials

- **Admin Email**: admin@example.com
- **Admin Password**: admin123

⚠️ **Change these in production!**

## Troubleshooting

### Container won't start
- Check logs: `docker-compose logs app`
- Verify questions directory exists: `ls /opt/academyfirstaid/questions`
- Check port availability: `netstat -tlnp | grep 3000`

### nginx errors
- Test config: `sudo nginx -t`
- Check logs: `sudo tail -f /var/log/nginx/error.log`
- Verify SSL certificates: `sudo certbot certificates`

### Database issues
- Database location: `/opt/academyfirstaid/flashcards-app/data/app.db`
- Check permissions: `ls -la /opt/academyfirstaid/flashcards-app/data/`

## Next Steps

1. ✅ Server setup complete
2. ✅ Docker and nginx configured
3. ✅ GitHub Actions workflow ready
4. ⏳ Add GitHub secrets
5. ⏳ Push to GitHub to trigger first deployment
6. ⏳ Setup SSL certificate
7. ⏳ Copy questions CSV files
8. ⏳ Change default admin credentials

## Support

For issues or questions, check:
- `deploy/README.md` for detailed deployment guide
- Server logs: `docker-compose logs`
- nginx logs: `/var/log/nginx/`
