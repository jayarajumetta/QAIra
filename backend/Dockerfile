FROM node:20-alpine

WORKDIR /app

# Install sqlite
RUN apk add --no-cache sqlite

# Copy files
COPY . .

# Make init script executable
RUN chmod +x init-db.sh

CMD ["sh", "init-db.sh"]