FROM mcr.microsoft.com/playwright:v1.47.0-jammy

WORKDIR /app

# Copy dependency definitions
COPY package*.json ./

# Install production dependencies
RUN npm ci --omit=dev || npm install

# Copy application source code
COPY . .

ENV PORT=3001
ENV NODE_ENV=production
ENV HEADLESS=true
ENV PLAYWRIGHT_BROWSERS_PATH=0

EXPOSE 3001

CMD ["npm", "start"]
