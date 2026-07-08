# ---- Nuwa Persona Chat ----
FROM node:22-alpine

WORKDIR /app

# Install dependencies first for better layer caching
COPY package.json package-lock.json ./
RUN npm ci

# Copy source and build the frontend
COPY . .
RUN npm run build

ENV PORT=8787
ENV HOST=0.0.0.0
EXPOSE 8787

# Run the Express server, which serves both the API and the built frontend (dist/)
CMD ["npx", "tsx", "server/index.ts"]
