const { Client, RemoteAuth, MessageMedia } = require('whatsapp-web.js');
const { MongoStore } = require('wwebjs-mongo');
const qrcode = require('qrcode');
const express = require('express');
const session = require('express-session');
const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// --- CONNEXION À MONGODB ---
const MONGO_URI = process.env.MONGO_URI;
mongoose.connect(MONGO_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log("Connecté à MongoDB"))
  .catch(err => console.error("Erreur MongoDB :", err));

// Schéma pour cryptomonnaies
const cryptoSchema = new mongoose.Schema({
  symbol: { type: String, required: true, unique: true },
  rate: { type: Number, required: true }
});
const Crypto = mongoose.model("Crypto", cryptoSchema);

// Schéma pour session WhatsApp
const store = new MongoStore({ mongoose });

// --- EXPRESS ---
const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(session({ secret: process.env.SESSION_SECRET || 'monSecret', resave: false, saveUninitialized: false }));

app.get('/', (req, res) => {
  if (req.session.loggedIn) return res.redirect('/dashboard');
  res.send(`
    <html><body>
      <h1>Connexion</h1>
      <form action="/login" method="POST">
        <label>Utilisateur:</label><input type="text" name="username" required>
        <label>Mot de passe:</label><input type="password" name="password" required>
        <button>Connexion</button>
      </form>
    </body></html>
  `);
});

app.post('/login', (req, res) => {
  const { username, password } = req.body;
  if (username === process.env.ADMIN_USER && password === process.env.ADMIN_PASS) {
    req.session.loggedIn = true;
    res.redirect('/dashboard');
  } else {
    res.send('Erreur. <a href="/">Réessayer</a>');
  }
});

let qrCodeUrl = null;
app.get('/dashboard', (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/');
  const qrContent = qrCodeUrl ? `<img src="${qrCodeUrl}" alt="QR Code" />` : "<p>Attente QR...</p>";
  res.send(`<html><body><h1>Dashboard</h1>${qrContent}<br><a href="/config">Config</a></body></html>`);
});

app.get('/config', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/');
  try {
    const cryptos = await Crypto.find({});
    const tableRows = cryptos.length ? cryptos.map(c => `<tr><td>${c.symbol}</td><td>${c.rate}</td></tr>`).join('') : '<tr><td colspan="2">Aucune donnée</td></tr>';
    res.send(`
      <html><body>
        <h1>Configuration</h1>
        <table border="1"><tr><th>Crypto</th><th>Taux</th></tr>${tableRows}</table>
        <form action="/config" method="POST">
          <label>Symbole:</label><input type="text" name="symbol" required>
          <label>Taux:</label><input type="number" step="0.01" name="rate" required>
          <button>Ajouter</button>
        </form>
        <a href="/dashboard">Retour</a>
      </body></html>
    `);
  } catch (err) {
    console.error("Erreur config:", err);
    res.send("Erreur serveur.");
  }
});

app.post('/config', async (req, res) => {
  if (!req.session.loggedIn) return res.redirect('/');
  const { symbol, rate } = req.body;
  try {
    await Crypto.findOneAndUpdate(
      { symbol: symbol.toUpperCase() },
      { rate: parseFloat(rate) },
      { upsert: true }
    );
    res.redirect('/config');
  } catch (err) {
    console.error("Erreur ajout crypto:", err);
    res.send("Erreur lors de l'ajout.");
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`Serveur sur port ${PORT}`));

// --- WHATSAPP ---
const userState = {};
const client = new Client({
  authStrategy: new RemoteAuth({
    store: store,
    backupSyncIntervalMs: 300000
  }),
  puppeteer: {
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
    headless: true
  }
});

client.on('qr', (qr) => {
  qrcode.toDataURL(qr, (err, url) => {
    qrCodeUrl = err ? null : url;
    console.log('QR généré:', err || 'OK');
  });
});

client.on('ready', () => {
  console.log('WhatsApp prêt');
  qrCodeUrl = null;
});

client.on('message', async (message) => {
  const userId = message.from;
  if (!userState[userId]) userState[userId] = { step: 'welcome' };
  const state = userState[userId];

  let media;
  try {
    media = MessageMedia.fromFilePath(path.join(__dirname, 'images', 'tems.webp'));
  } catch (err) {
    console.error("Erreur chargement image:", err);
    await client.sendMessage(userId, "Erreur interne. Contactez le support.");
    return;
  }

  if (message.body.trim() === '0') {
    state.step = 'welcome';
    await client.sendMessage(userId, media, { caption: "Bonjour, bienvenue sur NBBC BOT!\n1️⃣ Acheter\n2️⃣ Vendre\n3️⃣ Consulter les taux\n4️⃣ Support" });
    return;
  }

  switch (state.step) {
    case 'welcome':
      await client.sendMessage(userId, media, { caption: "Bonjour, bienvenue sur NBBC BOT!\n1️⃣ Acheter\n2️⃣ Vendre\n3️⃣ Consulter les taux\n4️⃣ Support" });
      state.step = 'main_menu';
      break;

    case 'main_menu':
      await handleMainMenu(state, message.body, userId);
      break;

    case 'buy_crypto':
      await handleBuyCrypto(state, message.body, userId);
      break;

    case 'buy_amount':
      await handleBuyAmount(state, message.body, userId);
      break;

    case 'confirm_buy':
      await handleConfirmBuy(state, message.body, userId);
      break;

    case 'sell_crypto':
      await handleSellCrypto(state, message.body, userId);
      break;

    case 'sell_amount':
      await handleSellAmount(state, message.body, userId);
      break;

    case 'confirm_sell':
      await handleConfirmSell(state, message.body, userId);
      break;

    case 'check_rates':
      await handleCheckRates(message.body, userId);
      break;

    case 'support':
      await handleSupport(state, userId);
      break;

    default:
      state.step = 'welcome';
      break;
  }
});

client.initialize();

// --- FONCTIONS DE GESTION ---
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
      await client.sendMessage(userId, "Option invalide. Choisissez 1, 2, 3 ou 4, ou envoyez 0 pour revenir.");
  }
}

async function handleBuyCrypto(state, choice, userId) {
  state.crypto = choice.toUpperCase();
  state.step = 'buy_amount';
  await client.sendMessage(userId, `Combien de ${state.crypto} souhaitez-vous acheter ? (en USD)`);
}

async function handleBuyAmount(state, amount, userId) {
  state.amount = parseFloat(amount);
  if (isNaN(state.amount)) {
    await client.sendMessage(userId, "Montant invalide. Entrez un nombre.");
    return;
  }
  const buyRate = await getCryptoRateFromDB(state.crypto);
  if (buyRate) {
    const total = (state.amount / buyRate).toFixed(6);
    await client.sendMessage(userId, `Le taux pour ${state.crypto} est ${buyRate} USD.\nPour ${state.amount} USD, vous obtiendrez ${total} ${state.crypto}.\nConfirmez avec "Oui".`);
    state.step = 'confirm_buy';
  } else {
    await client.sendMessage(userId, "Cette cryptomonnaie n'est pas configurée.");
    state.step = 'main_menu';
  }
}

async function handleConfirmBuy(state, confirmation, userId) {
  if (confirmation.toLowerCase() === 'oui') {
    await client.sendMessage(userId, "Commande validée. Instructions de paiement sous peu.");
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
  state.amount = parseFloat(amount);
  if (isNaN(state.amount)) {
    await client.sendMessage(userId, "Montant invalide. Entrez un nombre.");
    return;
  }
  const sellRate = await getCryptoRateFromDB(state.crypto);
  if (sellRate) {
    const totalSell = (state.amount * sellRate).toFixed(2);
    await client.sendMessage(userId, `Le taux pour ${state.crypto} est ${sellRate} USD.\nPour ${state.amount} ${state.crypto}, vous recevrez ${totalSell} USD.\nConfirmez avec "Oui".`);
    state.step = 'confirm_sell';
  } else {
    await client.sendMessage(userId, "Cette cryptomonnaie n'est pas configurée.");
    state.step = 'main_menu';
  }
}

async function handleConfirmSell(state, confirmation, userId) {
  if (confirmation.toLowerCase() === 'oui') {
    await client.sendMessage(userId, "Transaction validée. Envoyez vos cryptos à l'adresse fournie.");
  } else {
    await client.sendMessage(userId, "Transaction annulée.");
  }
  state.step = 'main_menu';
}

async function handleCheckRates(crypto, userId) {
  const rate = await getCryptoRateFromDB(crypto.toUpperCase());
  if (rate) {
    await client.sendMessage(userId, `Le taux de ${crypto.toUpperCase()} est ${rate} USD.`);
  } else {
    await client.sendMessage(userId, "Cette cryptomonnaie n'est pas configurée.");
  }
  userState[userId].step = 'main_menu';
}

async function handleSupport(state, userId) {
  await client.sendMessage(userId, "Merci pour votre question. Un agent vous répondra sous peu.");
  state.step = 'main_menu';
}

async function getCryptoRateFromDB(symbol) {
  try {
    const crypto = await Crypto.findOne({ symbol: symbol.toUpperCase() });
    return crypto ? crypto.rate : null;
  } catch (err) {
    console.error("Erreur récupération taux:", err);
    return null;
  }
}