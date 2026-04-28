const { default: makeWASocket, useMultiFileAuthState, DisconnectReason } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const axios = require('axios');
const fs = require('fs');

// ─── CONFIG ───────────────────────────────────────────────────────────────────
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL; // Set this in Railway environment variables
const PROMO_KEYWORDS = [
  'buy now', 'limited offer', 'dm me', 'dm for', 'whatsapp me', 'call me',
  'discount', 'offer', 'sale', 'promo', 'promote', 'promotion', 'advertis',
  'service', 'hiring', 'freelance', 'paid', 'price', 'cost', 'free trial',
  'click here', 'link in bio', 'check out my', 'launching', 'new product',
  'business opportunity', 'earn money', 'work from home', 'passive income',
  'invest', 'crypto', 'nft', 'referral', 'commission', 'affiliate'
];

// ─── KEYWORD FILTER ────────────────────────────────────────────────────────────
function isPromotional(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
  return PROMO_KEYWORDS.some(keyword => lower.includes(keyword));
}

// ─── SEND ALERT TO MAKE ────────────────────────────────────────────────────────
async function sendAlert(groupName, sender, message) {
  if (!MAKE_WEBHOOK_URL) {
    console.log('⚠️  No MAKE_WEBHOOK_URL set — skipping alert');
    return;
  }

  try {
    await axios.post(MAKE_WEBHOOK_URL, {
      groupName,
      sender,
      message,
      timestamp: new Date().toISOString()
    });
    console.log(`✅ Alert sent for message in: ${groupName}`);
  } catch (err) {
    console.error('❌ Failed to send alert:', err.message);
  }
}

// ─── MAIN ──────────────────────────────────────────────────────────────────────
async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState('auth_info');

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true, // QR code will show in Railway logs on first run
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      console.log('📱 Scan the QR code above with your WhatsApp app');
    }

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
      // Only process group messages, skip your own messages
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

        // Get group name
        let groupName = groupId;
        try {
          const meta = await sock.groupMetadata(groupId);
          groupName = meta.subject;
        } catch (_) {}

        const sender = msg.key.participant || msg.key.remoteJid;
        console.log(`🚨 Promo message detected in: ${groupName}`);
        console.log(`   From: ${sender}`);
        console.log(`   Message: ${text.substring(0, 100)}...`);

        await sendAlert(groupName, sender, text);
      }
    }
  });
}

startBot();
