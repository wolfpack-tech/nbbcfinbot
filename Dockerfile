FROM node:20.17.0
# Installation de Chromium

WORKDIR /app


COPY package*.json ./

RUN npm install
RUN npm install puppeteer


COPY . /app


EXPOSE 5000




CMD ["npm" , "start"]
