// Importations
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- CONNEXION À MONGODB ---
mongoose.connect(process.env.MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connecté à MongoDB"))
  .catch(err => console.error("Erreur de connexion MongoDB :", err));

  console.log("Mongo URI:", process.env.MONGO_URI);


// Schéma et modèle Mongoose pour les cryptomonnaies
const cryptoSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  rate: { type: Number, required: true }
});

const Crypto = mongoose.model("Crypto", cryptoSchema);

// --- INITIALISATION D'EXPRESS ET DES MIDDLEWARES ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: 'monSecret', resave: false, saveUninitialized: false }));

// --- PARTIE WEB ---

// Page de connexion (login)
app.get('/', (req, res) => {
  if (req.session.loggedIn) {
    return res.redirect('/dashboard');
  }
  res.send(`
    <html>
      <head>
        <title>Connexion</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          form { max-width: 300px; margin: auto; }
          label { display: block; margin-top: 10px; }
          input { width: 100%; padding: 8px; margin-top: 5px; }
          button { margin-top: 15px; padding: 10px; width: 100%; }
        </style>
      </head>
      <body>
        <h1>Connexion</h1>
        <form action="/login" method="POST">
          <label for="username">Nom d'utilisateur :</label>
          <input type="text" id="username" name="username" required>
          <label for="password">Mot de passe :</label>
          <input type="password" id="password" name="password" required>
          <button type="submit">Se connecter</button>
        </form>
      </body>
    </html>
  `);
});

// Traitement du login
app.post('/login', (req, res) => {
  const { username, password } = req.body;
  // Pour cet exemple, on accepte admin / admin123
  if (username === 'admin' && password === 'admin123') {
    req.session.loggedIn = true;
    res.redirect('/dashboard');
  } else {
    res.send('Identifiants invalides. <a href="/">Réessayer</a>');
  }
});

// Dashboard affichant le QR code et un lien vers la configuration
app.get('/dashboard', (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect('/');
  }
  const qrContent = qrCodeUrl 
    ? `<img src="${qrCodeUrl}" alt="QR Code de connexion à WhatsApp" />`
    : "<p>Veuillez attendre le QR Code...</p>";
  res.send(`
    <html>
      <head>
        <title>Dashboard</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          a.button { display: inline-block; padding: 10px 20px; background: #007BFF; color: white; text-decoration: none; margin-top: 20px; }
        </style>
      </head>
      <body>
        <h1>Dashboard</h1>
        ${qrContent}
        <br>
        <a class="button" href="/config">Configuration du Bot</a>
      </body>
    </html>
  `);
});

// Page de configuration du Bot
app.get('/config', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect('/');
  }
  // Récupération des cryptos configurées dans MongoDB
  let cryptos = await Crypto.find({});
  let tableRows = cryptos.map(c => `<tr><td>${c.symbol}</td><td>${c.rate}</td></tr>`).join('');
  if (!tableRows) tableRows = '<tr><td colspan="2">Aucune donnée</td></tr>';
  res.send(`
    <html>
      <head>
        <title>Configuration du Bot</title>
        <style>
          body { font-family: Arial, sans-serif; padding: 20px; }
          table { border-collapse: collapse; width: 100%; margin-bottom: 20px; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
          th { background-color: #f2f2f2; }
          form { max-width: 400px; }
          label { display: block; margin-top: 10px; }
          input { width: 100%; padding: 8px; margin-top: 5px; }
          button { margin-top: 15px; padding: 10px; width: 100%; }
        </style>
      </head>
      <body>
        <h1>Configuration du Bot</h1>
        <h2>Liste des Cryptomonnaies et leurs taux d'échange</h2>
        <table>
          <thead>
            <tr>
              <th>Cryptomonnaie</th>
              <th>Taux (USD)</th>
            </tr>
          </thead>
          <tbody>
            ${tableRows}
          </tbody>
        </table>
        <h2>Ajouter une Cryptomonnaie</h2>
        <form action="/config" method="POST">
          <label for="symbol">Symbole (ex : BTC) :</label>
          <input type="text" id="symbol" name="symbol" required>
          <label for="rate">Taux d'échange (USD) :</label>
          <input type="number" step="0.01" id="rate" name="rate" required>
          <button type="submit">Ajouter</button>
        </form>
        <br>
        <a href="/dashboard">Retour au Dashboard</a>
      </body>
    </html>
  `);
});

// Traitement du formulaire de configuration
app.post('/config', async (req, res) => {
  if (!req.session.loggedIn) {
    return res.redirect('/');
  }
  let { symbol, rate } = req.body;
  symbol = symbol.toUpperCase();
  rate = parseFloat(rate);
  try {
    // On crée ou met à jour la configuration pour ce symbole
    await Crypto.findOneAndUpdate({ symbol: symbol }, { rate: rate }, { upsert: true });
  } catch (err) {
    console.error(err);
  }
  res.redirect('/config');
});

// Démarrage du serveur web sur le port 5000
app.listen(5000, () => {
  console.log('Serveur web démarré sur http://localhost:5000');
});


// --- PARTIE WHATSAPP ---

// Variable globale pour stocker le QR code du bot
let qrCodeUrl;

// Initialisation de l'état utilisateur (pour la gestion du workflow WhatsApp)
const userState = {};

// Création et configuration du client WhatsApp
const client = new Client({
  authStrategy: new LocalAuth({ dataPath: './.wwebjs_auth' }),
});

// Génération du QR code pour la connexion du bot
client.on('qr', (qr) => {
  console.log('QR Code reçu. Scannez avec WhatsApp pour connecter le bot.');
  qrcode.toDataURL(qr, (err, url) => {
    if (err) {
      console.error('Erreur lors de la génération du QR code :', err);
    } else {
      qrCodeUrl = url;
    }
  });
});

// Lorsque le bot est prêt
client.on('ready', () => {
  console.log('Client WhatsApp prêt !');
});

// Fonction utilitaire pour récupérer le taux configuré depuis MongoDB
async function getCryptoRateFromDB(symbol) {
  const crypto = await Crypto.findOne({ symbol: symbol.toUpperCase() });
  return crypto ? crypto.rate : null;
}

// Gestion des messages entrants du bot WhatsApp
client.on('message', async (message) => {
  const userId = message.from;
  // Initialisation de l'état de l'utilisateur s'il n'existe pas
  if (!userState[userId]) {
    userState[userId] = { step: 'welcome' };
  }
  const state = userState[userId];

  // Chargement d'un média (exemple : logo ou image d'accueil)
  const media = MessageMedia.fromFilePath('./images/tems.webp');

  // Option : envoyer "0" permet de revenir au menu principal
  if (message.body.trim() === '0') {
    state.step = 'welcome';
    await client.sendMessage(
      userId,
      media,
      { caption: "Bonjour, bienvenue sur NBBC BOT!\nQue souhaitez-vous faire ?\n1️⃣ Acheter de la cryptomonnaie\n2️⃣ Vendre de la cryptomonnaie\n3️⃣ Consulter les taux\n4️⃣ Support client" }
    );
    return;
  }

  // Workflow du bot
  switch (state.step) {
    case 'welcome':
      await client.sendMessage(
        userId,
        media,
        { caption: "Bonjour, bienvenue sur NBBC BOT!\nQue souhaitez-vous faire ?\n1️⃣ Acheter de la cryptomonnaie\n2️⃣ Vendre de la cryptomonnaie\n3️⃣ Consulter les taux\n4️⃣ Support client" }
      );
      state.step = 'main_menu';
      break;

    case 'main_menu':
      handleMainMenu(state, message.body, userId);
      break;

    case 'buy_crypto':
      handleBuyCrypto(state, message.body, userId);
      break;

    case 'buy_amount':
      handleBuyAmount(state, message.body, userId);
      break;

    case 'confirm_buy':
      handleConfirmBuy(state, message.body, userId);
      break;

    case 'sell_crypto':
      handleSellCrypto(state, message.body, userId);
      break;

    case 'sell_amount':
      handleSellAmount(state, message.body, userId);
      break;

    case 'confirm_sell':
      handleConfirmSell(state, message.body, userId);
      break;

    case 'check_rates':
      handleCheckRates(message.body, userId);
      break;

    case 'support':
      handleSupport(state, userId);
      break;

    default:
      state.step = 'welcome';
      break;
  }
});

// Démarrer le client WhatsApp
client.initialize();


// --- Fonctions de gestion du workflow WhatsApp ---

async function handleMainMenu(state, choice, userId) {
  switch (choice) {
    case '1':
      state.step = 'buy_crypto';
      await client.sendMessage(userId, "Quelle cryptomonnaie souhaitez-vous acheter ? (ex: BTC, ETH, USDT)");
      break;
    case '2':
      state.step = 'sell_crypto';
      await client.sendMessage(userId, "Quelle cryptomonnaie souhaitez-vous vendre ? (ex: BTC, ETH, USDT)");
      break;
    case '3':
      state.step = 'check_rates';
      await client.sendMessage(userId, "Pour quelle cryptomonnaie souhaitez-vous consulter les taux ?");
      break;
    case '4':
      state.step = 'support';
      await client.sendMessage(userId, "Veuillez poser votre question, je vais essayer de vous aider !");
      break;
    default:
      await client.sendMessage(userId, "Option invalide. Veuillez choisir 1, 2, 3 ou 4, ou envoyer 0 pour revenir au menu principal.");
  }
}

async function handleBuyCrypto(state, choice, userId) {
  state.crypto = choice.toUpperCase();
  state.step = 'buy_amount';
  await client.sendMessage(userId, `Combien de ${state.crypto} souhaitez-vous acheter ? (en USD)`);
}

async function handleBuyAmount(state, amount, userId) {
  state.amount = amount;
  const buyRate = await getCryptoRateFromDB(state.crypto);
  if (buyRate) {
    const total = (state.amount / buyRate).toFixed(6);
    await client.sendMessage(userId, `Le taux configuré pour ${state.crypto} est ${buyRate} USD.\nPour ${state.amount} USD, vous obtiendrez ${total} ${state.crypto}.\nConfirmez avec "Oui" pour continuer.`);
    state.step = 'confirm_buy';
  } else {
    await client.sendMessage(userId, "Désolé, cette cryptomonnaie n'est pas configurée.");
    state.step = 'main_menu';
  }
}

async function handleConfirmBuy(state, confirmation, userId) {
  if (confirmation.toLowerCase() === 'oui') {
    await client.sendMessage(userId, "Votre commande a été validée. Vous recevrez des instructions de paiement sous peu.");
  } else {
    await client.sendMessage(userId, "Commande annulée.");
  }
  state.step = 'main_menu';
}

async function handleSellCrypto(state, choice, userId) {
  state.crypto = choice.toUpperCase();
  state.step = 'sell_amount';
  await client.sendMessage(userId, `Combien de ${state.crypto} souhaitez-vous vendre ? (en unité crypto)`);
}

async function handleSellAmount(state, amount, userId) {
  state.amount = amount;
  const sellRate = await getCryptoRateFromDB(state.crypto);
  if (sellRate) {
    const totalSell = (state.amount * sellRate).toFixed(2);
    await client.sendMessage(userId, `Le taux configuré pour ${state.crypto} est ${sellRate} USD.\nPour ${state.amount} ${state.crypto}, vous recevrez ${totalSell} USD.\nConfirmez avec "Oui" pour continuer.`);
    state.step = 'confirm_sell';
  } else {
    await client.sendMessage(userId, "Désolé, cette cryptomonnaie n'est pas configurée.");
    state.step = 'main_menu';
  }
}

async function handleConfirmSell(state, confirmation, userId) {
  if (confirmation.toLowerCase() === 'oui') {
    await client.sendMessage(userId, "Votre transaction a été validée. Envoyez vos cryptos à l'adresse fournie.");
  } else {
    await client.sendMessage(userId, "Transaction annulée.");
  }
  state.step = 'main_menu';
}

async function handleCheckRates(crypto, userId) {
  const rate = await getCryptoRateFromDB(crypto.toUpperCase());
  if (rate) {
    await client.sendMessage(userId, `Le taux configuré de ${crypto.toUpperCase()} est ${rate} USD.`);
  } else {
    await client.sendMessage(userId, "Désolé, cette cryptomonnaie n'est pas configurée.");
  }
  userState[userId].step = 'main_menu';
}

async function handleSupport(state, userId) {
  await client.sendMessage(userId, "Merci pour votre question. Un agent vous répondra sous peu.");
  state.step = 'main_menu';
}
