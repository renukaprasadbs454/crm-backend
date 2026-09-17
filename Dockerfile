FROM node:20-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package*.json ./
COPY prisma ./prisma
RUN npm ci --omit=dev && npx prisma generate

# App source
COPY . .

ENV NODE_ENV=production
EXPOSE 4001

# Apply pending migrations, then start the API
CMD ["sh", "-c", "npx prisma migrate deploy && node server.js"]
