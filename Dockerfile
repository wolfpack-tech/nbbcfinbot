FROM node:18
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm install
RUN apt-get update && apt-get install -y \
    libxss1 \
    libxtst6 \
    libx11-xcb1 \
    libgbm-dev \
    libasound2 \
    && rm -rf /var/lib/apt/lists/*
COPY . .
EXPOSE 5000
CMD ["node", "server.js"]