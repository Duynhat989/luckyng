# Use Node.js LTS version
FROM node:18-alpine

# Install dependencies required for sharp and native packages
RUN apk add --no-cache \
    python3 \
    make \
    g++ \
    cairo-dev \
    jpeg-dev \
    pango-dev \
    giflib-dev \
    pixman-dev

# Create working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production

# Copy entire source code
COPY . .

# Create temp_files directory if it doesn't exist
RUN mkdir -p app/modules/temp_files

# Expose port
EXPOSE 2053

# Run application
CMD ["node", "index.js"]
