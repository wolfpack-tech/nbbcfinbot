# Utilise une image Alpine légère avec Node.js
FROM node:20.17.0-alpine

# Définit le répertoire de travail
WORKDIR /nbbcbot

# Copie uniquement les fichiers nécessaires pour l'installation des dépendances
COPY package*.json ./

# Installe les dépendances en optimisant le cache
RUN npm install --omit=dev

# Installation manuelle des dépendances Chromium pour Puppeteer
RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    && npm install puppeteer-core

# Copie du reste des fichiers du projet
COPY . .

# Expose le port de l'application
EXPOSE 5000

# Commande pour lancer l'application
CMD ["npm", "start"]