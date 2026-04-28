const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, makeCacheableSignalKeyStore } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const PHONE_NUMBER = process.env.PHONE_NUMBER; // e.g. 919876543210 — country code + number, no + or spaces

const PROMO_KEYWORDS = [
  'buy now', 'limited offer', 'dm me', 'dm for', 'whatsapp me', 'call me',
  'discount', 'offer', 'sale', 'promo', 'promote', 'promotion', 'advertis',
  'service', 'hiring', 'freelance', 'paid', 'price', 'free trial',
  'click here', 'link in bio', 'check out my', 'launching', 'new product',
  'business opportunity', 'earn money', 'work from home', 'passive income',
  'invest', 'crypto', 'nft', 'referral', 'commission', 'affiliate'
];

function isPromotional(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROMO_KEYWORDS.some(keyword => lower.includes(keyword));
}

async function sendAlert(groupName, sender, message) {
  if (!MAKE_WEBHOOK_URL) {
    console.log('⚠️  No MAKE_WEBHOOK_URL set — skipping alert');
    return;
  }
  try {
    await axios.post(MAKE_WEBHOOK_URL, { groupName, sender, message, timestamp: new Date().toISOString() });
    console.log(`✅ Alert sent for message in: ${groupName}`);
  } catch (err) {
    console.error('❌ Failed to send alert:', err.message);
  }
}

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: {
      creds: state.creds,
      keys: makeCacheableSignalKeyStore(state.keys, console),
    },
    printQRInTerminal: false,
    browser: ['LAN Monitor', 'Chrome', '22.0'],
  });

  sock.ev.on('creds.update', saveCreds);

  if (!sock.authState.creds.registered) {
    if (!PHONE_NUMBER) {
      console.error('❌ Set PHONE_NUMBER in Railway environment variables (e.g. 919876543210)');
      process.exit(1);
    }
    await new Promise(resolve => setTimeout(resolve, 3000));
try {
  const code = await sock.requestPairingCode(PHONE_NUMBER);
  console.log('');
  console.log('========================================');
  console.log(`  PAIRING CODE: ${code}`);
  console.log('========================================');
  console.log('WhatsApp → Settings → Linked Devices → Link a Device → Link with phone number instead');
  console.log('');
} catch (err) {
  console.log('Pairing code request failed, will retry on reconnect:', err.message);
}
  }

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === 'close') {
      const shouldReconnect = (lastDisconnect?.error instanceof Boom)
        ? lastDisconnect.error.output?.statusCode !== DisconnectReason.loggedOut
        : true;
      console.log('🔌 Connection closed. Reconnecting:', shouldReconnect);
      if (shouldReconnect) startBot();
    } else if (connection === 'open') {
      console.log('✅ WhatsApp connected and monitoring groups');
    }
  });

  sock.ev.on('messages.upsert', async ({ messages }) => {
    for (const msg of messages) {
      if (!msg.key.remoteJid.endsWith('@g.us')) continue;
      if (msg.key.fromMe) continue;

      const text =
        msg.message?.conversation ||
        msg.message?.extendedTextMessage?.text ||
        msg.message?.imageMessage?.caption ||
        '';

      if (!text) continue;

      if (isPromotional(text)) {
        const groupId = msg.key.remoteJid;
        let groupName = groupId;
        try {
          const meta = await sock.groupMetadata(groupId);
          groupName = meta.subject;
        } catch (_) {}

        const sender = msg.key.participant || msg.key.remoteJid;
        console.log(`🚨 Promo message detected in: ${groupName}`);
        await sendAlert(groupName, sender, text);
      }
    }
  });
}

startBot();
