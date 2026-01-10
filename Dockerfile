FROM node:18-slim

# Install sqlite3 and curl (needed for image downloads)
RUN apt-get update && apt-get install -y \
    sqlite3 \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy flashcards-app directory
COPY flashcards-app /app/flashcards-app

# Create questions directory (will be mounted as volume in production)
RUN mkdir -p /app/questions

# Set working directory to flashcards-app
WORKDIR /app/flashcards-app

# Expose port
EXPOSE 3000

# Set environment variable
ENV PORT=3000
ENV NODE_ENV=production

# Start the server
CMD ["node", "server.js"]





