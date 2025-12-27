/**
 * Standalone WhatsApp Web Worker
 * 
 * This worker runs independently and uses whatsapp-web.js to connect to WhatsApp
 * via QR code authentication, without requiring WhatsApp Business API.
 * 
 * Deploy this on Railway, Render, DigitalOcean, or any Node.js hosting service.
 * 
 * Usage:
 *   npm run worker:whatsapp-web
 *   or
 *   tsx scripts/whatsapp-web-worker.ts
 */

import { Client, LocalAuth } from 'whatsapp-web.js';
import mongoose from 'mongoose';
import BotSettings from '../lib/models/BotSettings';
import Message from '../lib/models/Message';
import { processChatMessage } from '../lib/services/chatService';
import * as qrcode from 'qrcode';

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI environment variable is required');
  process.exit(1);
}

if (!OPENAI_API_KEY) {
  console.error('❌ OPENAI_API_KEY environment variable is required');
  process.exit(1);
}

// Store active client instances
const clientInstances = new Map<string, Client>();

// Cache for bot settings
const botSettingsCache = new Map<string, { settings: any; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    if (mongoose.connection.readyState === 1) {
      const dbName = mongoose.connection.db?.databaseName || 'unknown';
      console.log(`📊 Already connected to MongoDB. Database: ${dbName}`);
      return mongoose.connection;
    }

    console.log(`🔌 Connecting to MongoDB...`);
    await mongoose.connect(MONGODB_URI!, {
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    const dbName = mongoose.connection.db?.databaseName || 'unknown';
    console.log(`✅ Connected to MongoDB`);
    console.log(`   Active database: ${dbName}`);
    
    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Get bot settings from database
 */
async function getBotSettings(botId: string): Promise<any | null> {
  await connectDB();

  const cacheKey = `whatsapp_web_${botId}`;
  const cached = botSettingsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
    return cached.settings;
  }

  const botSettings = await BotSettings.findOne({
    botId,
    'whatsapp.enabled': true
  }).select('botId name userId whatsapp welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;

  if (botSettings) {
    botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
  }

  return botSettings;
}

/**
 * Send message via WhatsApp Web
 */
async function sendMessage(client: Client, to: string, message: string): Promise<void> {
  try {
    const phoneNumber = to.replace(/[^0-9]/g, '');
    const chatId = `${phoneNumber}@c.us`;
    await client.sendMessage(chatId, message);
    console.log(`✅ Message sent to ${to}`);
  } catch (error: any) {
    console.error(`❌ Error sending message:`, error);
    throw error;
  }
}

/**
 * Handle incoming message
 */
async function handleMessage(client: Client, botSettings: any, msg: any) {
  // Ignore status messages and group messages
  // Group chat IDs end with @g.us, personal chats end with @c.us
  if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us')) {
    return;
  }

  const from = msg.from.replace('@c.us', '');
  const text = msg.body || '';

  console.log(`📨 WhatsApp Web message: from=${from}, text="${text.substring(0, 50)}..."`);

  // Handle welcome message
  const lowerText = text.toLowerCase().trim();
  if (lowerText === '/start' || lowerText === 'start' || lowerText === 'hi' || lowerText === 'hello' || lowerText === 'xin chào') {
    try {
      await sendMessage(
        client,
        from,
        botSettings.welcomeMessage || `Xin chào! Tôi là ${botSettings.name}. Tôi có thể giúp gì cho bạn?`
      );
    } catch (error) {
      console.error('❌ Error sending welcome message:', error);
    }
    return;
  }

  // Ignore empty messages
  if (!text.trim()) {
    return;
  }

  try {
    console.log(`🤖 Processing message with AI: "${text}"`);
    
    const reply = await processChatMessage(
      botSettings,
      text,
      OPENAI_API_KEY!,
      'whatsapp'
    );

    console.log(`✅ AI reply generated: "${reply.substring(0, 100)}..."`);

    // Send reply
    await sendMessage(client, from, reply);
    console.log('✅ Reply sent');

    // Track message asynchronously
    setImmediate(async () => {
      try {
        const messageRecord = new Message({
          userId: botSettings.userId,
          botId: botSettings.botId,
          message: text,
          response: reply,
          timestamp: new Date(),
          sessionId: `whatsapp_web_${from}`
        });
        await messageRecord.save();
        console.log('✅ Message tracked in database');
      } catch (trackingError) {
        console.error('⚠️ Error tracking message:', trackingError);
      }
    });
  } catch (error: any) {
    console.error('❌ Error processing message:', error);

    const errorMsg = error.message?.includes('timeout')
      ? 'Xin lỗi, yêu cầu của bạn mất quá nhiều thời gian để xử lý. Vui lòng thử lại sau.'
      : error.message?.includes('Rate limit')
      ? 'Xin lỗi, hệ thống đang quá tải. Vui lòng thử lại sau vài giây.'
      : 'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.';

    try {
      await sendMessage(client, from, errorMsg);
    } catch {
      // Ignore if sending error message fails
    }
  }
}

/**
 * Initialize and start WhatsApp Web client for a bot
 */
async function startClient(botId: string) {
  if (clientInstances.has(botId)) {
    const existingClient = clientInstances.get(botId)!;
    if (existingClient.info) {
      console.log(`✅ WhatsApp Web client already authenticated for bot: ${botId}`);
      return existingClient;
    }
  }

  const botSettings = await getBotSettings(botId);
  if (!botSettings) {
    console.error(`❌ Bot settings not found for bot: ${botId}`);
    return null;
  }

  console.log(`🚀 Starting WhatsApp Web client for bot: ${botSettings.name} (${botId})`);

  // Create client with LocalAuth
  const client = new Client({
    authStrategy: new LocalAuth({
      clientId: `whatsapp_web_${botId}`,
      dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--no-first-run',
        '--no-zygote',
        '--single-process',
        '--disable-gpu',
        '--disable-software-rasterizer',
        '--disable-extensions',
        '--disable-background-networking',
        '--disable-background-timer-throttling',
        '--disable-backgrounding-occluded-windows',
        '--disable-breakpad',
        '--disable-client-side-phishing-detection',
        '--disable-default-apps',
        '--disable-features=TranslateUI',
        '--disable-hang-monitor',
        '--disable-ipc-flooding-protection',
        '--disable-popup-blocking',
        '--disable-prompt-on-repost',
        '--disable-renderer-backgrounding',
        '--disable-sync',
        '--metrics-recording-only',
        '--mute-audio',
        '--no-default-browser-check',
        '--no-first-run',
        '--safebrowsing-disable-auto-update',
        '--enable-automation',
        '--password-store=basic',
        '--use-mock-keychain'
      ],
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || (process.platform === 'linux' ? '/usr/bin/chromium' : undefined)
    }
  });

  // Handle QR code
  client.on('qr', async (qr: string) => {
    console.log(`📱 QR Code generated for bot: ${botId}`);
    try {
      const qrDataUrl = await qrcode.toDataURL(qr);
      console.log(`✅ QR Code generated (data URL length: ${qrDataUrl.length})`);
      
      // Lưu QR code vào MongoDB
      await connectDB();
      await BotSettings.updateOne(
        { botId },
        {
          $set: {
            'whatsapp.qrCode': qrDataUrl,
            'whatsapp.qrCodeExpiresAt': new Date(Date.now() + 5 * 60 * 1000) // 5 phút
          }
        }
      );
      
      console.log(`✅ QR Code saved to database for bot: ${botId}`);
      console.log(`💡 Please scan the QR code with WhatsApp to authenticate`);
    } catch (error) {
      console.error('❌ Error generating QR code image:', error);
      console.log(`📱 QR Code (raw): ${qr.substring(0, 100)}...`);
    }
  });

  // Handle authentication success
  client.on('ready', async () => {
    console.log(`✅ WhatsApp Web client ready for bot: ${botId}`);
    if (client.info) {
      console.log(`   Phone: ${client.info.wid.user}`);
      console.log(`   Name: ${client.info.pushname || 'N/A'}`);
    }
    
    // Lưu thông tin phone và xóa QR code khỏi database khi đã authenticated
    try {
      await connectDB();
      await BotSettings.updateOne(
        { botId },
        {
          $set: {
            'whatsapp.phoneNumber': client.info?.wid.user || '',
            'whatsapp.verifiedName': client.info?.pushname || ''
          },
          $unset: {
            'whatsapp.qrCode': '',
            'whatsapp.qrCodeExpiresAt': ''
          }
        }
      );
      console.log(`✅ Phone number and name saved, QR code cleared for bot: ${botId}`);
    } catch (error) {
      console.error('❌ Error updating bot settings:', error);
    }
  });

  // Handle authentication failure
  client.on('auth_failure', (msg) => {
    console.error(`❌ WhatsApp Web auth failure for bot ${botId}:`, msg);
    clientInstances.delete(botId);
  });

  // Handle disconnection
  client.on('disconnected', (reason) => {
    console.log(`⚠️ WhatsApp Web disconnected for bot ${botId}:`, reason);
    clientInstances.delete(botId);
  });

  // Handle incoming messages
  client.on('message', async (msg) => {
    try {
      await handleMessage(client, botSettings, msg);
    } catch (error) {
      console.error('❌ Error in message handler:', error);
    }
  });

  // Initialize client
  try {
    await client.initialize();
    clientInstances.set(botId, client);
    console.log(`✅ WhatsApp Web client initialized for bot: ${botId}`);
    return client;
  } catch (error) {
    console.error(`❌ Failed to initialize WhatsApp Web client for bot ${botId}:`, error);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting WhatsApp Web Worker Service...');
  console.log('📋 Configuration:');
  console.log(`   - MongoDB: ${MONGODB_URI ? 'Configured' : 'Missing'}`);
  console.log(`   - OpenAI API: ${OPENAI_API_KEY ? 'Configured' : 'Missing'}`);

  // Connect to database
  await connectDB();

  // Debug: Check all bots
  const allBots = await BotSettings.find({}).select('botId name whatsapp').lean() as any[];
  console.log(`📋 Total bots in database: ${allBots.length}`);
  allBots.forEach((bot, index) => {
    console.log(`   ${index + 1}. Bot: "${bot.botId}"`);
    console.log(`      Name: ${bot.name}`);
    console.log(`      WhatsApp enabled: ${bot.whatsapp?.enabled || false}`);
  });

  // Get enabled bots
  const bots = await BotSettings.find({
    'whatsapp.enabled': true
  }).select('botId name userId whatsapp welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

  console.log(`🔍 Found ${bots.length} enabled WhatsApp bot(s)`);

  if (bots.length === 0) {
    console.warn('⚠️ No enabled WhatsApp bots found in database');
    console.log('💡 Please enable at least one bot in the dashboard');
    console.log('🔄 Will retry in 30 seconds...');
    
    setTimeout(() => {
      console.log('🔄 Retrying to find enabled bots...');
      main().catch((error) => {
        console.error('❌ Fatal error:', error);
        setTimeout(() => main(), 30000);
      });
    }, 30000);
    return;
  }

  // Start all bots
  for (const botSettings of bots) {
    try {
      await startClient(botSettings.botId);
    } catch (error) {
      console.error(`❌ Failed to start bot ${botSettings.botId}:`, error);
    }
  }

  // Refresh bot list every 5 minutes
  setInterval(async () => {
    try {
      const updatedBots = await BotSettings.find({
        'whatsapp.enabled': true
      }).select('botId name userId whatsapp welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

      // Start new bots
      for (const botSettings of updatedBots) {
        if (!clientInstances.has(botSettings.botId)) {
          console.log(`🆕 Found new bot: ${botSettings.name}`);
          await startClient(botSettings.botId);
        }
      }

      // Clear cache
      botSettingsCache.clear();
    } catch (error) {
      console.error('❌ Error refreshing bot list:', error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  console.log('✅ WhatsApp Web Worker Service is running');
  console.log('💡 Press Ctrl+C to stop');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Destroy all clients
  const clients = Array.from(clientInstances.values());
  for (const client of clients) {
    try {
      await client.destroy();
    } catch (error) {
      console.error('Error destroying client:', error);
    }
  }

  // Close database connection
  try {
    await mongoose.connection.close();
    console.log('✅ Database connection closed');
  } catch (error) {
    console.error('Error closing database:', error);
  }

  process.exit(0);
});

// Start the service
main().catch((error) => {
  console.error('❌ Fatal error:', error);
  process.exit(1);
});

