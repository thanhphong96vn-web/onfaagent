/**
 * Standalone Discord Worker
 * 
 * This worker runs independently and uses discord.js to connect to Discord
 * and handle messages via long polling (event-based).
 * 
 * Deploy this on Railway, Render, DigitalOcean, or any Node.js hosting service.
 * 
 * Usage:
 *   npm run worker:discord
 *   or
 *   tsx scripts/discord-worker.ts
 */

import { Client, GatewayIntentBits, Message as DiscordMessage, ChannelType } from 'discord.js';
import mongoose from 'mongoose';
import BotSettings from '../lib/models/BotSettings';
import Message from '../lib/models/Message';
import { processChatMessage } from '../lib/services/chatService';

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

// Cache for bot settings
const botSettingsCache = new Map<string, { settings: any; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

// Store active Discord bot instances
const botInstances = new Map<string, Client>();

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

  const cacheKey = `discord_${botId}`;
  const cached = botSettingsCache.get(cacheKey);
  
  // Check cache validity - also reload if cache is older than 30 seconds to catch recent updates
  if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
    const cacheAge = Date.now() - cached.timestamp;
    if (cacheAge > 30000) { // 30 seconds - reload to catch recent document additions
      console.log(`🔄 Cache is ${Math.round(cacheAge / 1000)}s old, reloading bot settings for: ${botId}`);
    } else {
      return cached.settings;
    }
  }

  const botSettings = await BotSettings.findOne({
    botId,
    'discord.enabled': true,
    'discord.botToken': { $exists: true }
  }).select('botId name userId discord welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;

  if (botSettings) {
    botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
    console.log(`✅ Loaded bot settings from DB for: ${botId} (${botSettings.documents?.length || 0} documents)`);
  }

  return botSettings;
}

/**
 * Send message via Discord
 */
async function sendMessage(client: Client, channelId: string, message: string): Promise<void> {
  try {
    const channel = await client.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a text channel`);
    }

    // Type assertion for sending message
    if ('send' in channel && typeof (channel as any).send === 'function') {
      await (channel as any).send(message);
      console.log(`[DISCORD] ✅ Message sent to channel: ${channelId}`);
    } else {
      throw new Error(`Channel ${channelId} does not support sending messages`);
    }
  } catch (error: any) {
    console.error(`[DISCORD] ❌ Error sending message to channel ${channelId}:`, error);
    throw error;
  }
}

/**
 * Handle incoming message
 */
async function handleMessage(client: Client, botSettings: any, msg: DiscordMessage) {
  // Ignore bot messages
  if (msg.author.bot) {
    return;
  }

  // Debug: Log message details
  console.log(`[DISCORD] 📨 Message received:`, {
    channelType: msg.channel.type,
    channelId: msg.channel.id,
    isDM: msg.channel.type === 1 || msg.channel.type === 3, // DM or GroupDM
    author: msg.author.tag,
    content: msg.content.substring(0, 50),
    mentions: msg.mentions.has(client.user!),
    isReply: msg.reference !== null
  });

  // Only handle DMs or mentions in channels
  // DM channel types: ChannelType.DM (1) or ChannelType.GroupDM (3)
  const isDM = msg.channel.type === ChannelType.DM || msg.channel.type === ChannelType.GroupDM;
  const isMentioned = msg.mentions.has(client.user!);
  const isReply = msg.reference !== null;

  if (!isDM && !isMentioned && !isReply) {
    console.log(`[DISCORD] ⏭️ Skipping message: not DM, not mentioned, not reply`);
    return;
  }

  const text = msg.content.replace(/<@!?\d+>/g, '').trim();
  const channelId = msg.channel.id;
  const userId = msg.author.id;

  console.log(`[DISCORD] 📨 Processing message: channelId=${channelId}, userId=${userId}, text="${text.substring(0, 50)}..."`);

  // Handle welcome message
  const lowerText = text.toLowerCase().trim();
  if (lowerText === '/start' || lowerText === 'start' || lowerText === 'hi' || lowerText === 'hello' || lowerText === 'xin chào' || lowerText === 'lô') {
    try {
      await sendMessage(
        client,
        channelId,
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
    
    // Debug: Log botSettings structure
    console.log(`[DISCORD] Bot settings check:`);
    console.log(`[DISCORD]   Bot ID: ${botSettings.botId}`);
    console.log(`[DISCORD]   FAQs count: ${botSettings.faqs?.length || 0}`);
    console.log(`[DISCORD]   Documents count: ${botSettings.documents?.filter((d: any) => d.enabled)?.length || 0}`);
    console.log(`[DISCORD]   URLs count: ${botSettings.urls?.filter((u: any) => u.enabled)?.length || 0}`);
    console.log(`[DISCORD]   Structured data count: ${botSettings.structuredData?.filter((s: any) => s.enabled)?.length || 0}`);
    
    const reply = await processChatMessage(
      botSettings,
      text,
      OPENAI_API_KEY!,
      'discord'
    );

    console.log(`✅ AI reply generated: "${reply.substring(0, 100)}..."`);

    // Send reply
    await sendMessage(client, channelId, reply);
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
          sessionId: `discord_${channelId}_${userId}`
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
      await sendMessage(client, channelId, errorMsg);
    } catch {
      // Ignore if sending error message fails
    }
  }
}

/**
 * Initialize and start Discord bot for a bot
 */
async function startBot(botId: string) {
  if (botInstances.has(botId)) {
    const existingClient = botInstances.get(botId)!;
    if (existingClient.isReady()) {
      console.log(`✅ Discord bot already connected for bot: ${botId}`);
      return existingClient;
    }
  }

  const botSettings = await getBotSettings(botId);
  if (!botSettings) {
    console.error(`❌ Bot settings not found for bot: ${botId}`);
    return null;
  }

  if (!botSettings.discord?.botToken) {
    console.error(`❌ Discord bot token not found for bot: ${botId}`);
    return null;
  }

  console.log(`🚀 Starting Discord bot for: ${botSettings.name} (${botId})`);

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  // Event handlers
  client.once('ready', () => {
    console.log(`✅ Discord bot logged in as: ${client.user?.tag}`);
    console.log(`   Bot ID: ${client.user?.id}`);
  });

  client.on('messageCreate', async (message) => {
    try {
      // Debug: Log all messages received
      console.log(`[DISCORD] 🔔 messageCreate event triggered:`, {
        author: message.author.tag,
        channelType: message.channel.type,
        content: message.content.substring(0, 50),
        isBot: message.author.bot
      });
      
      await handleMessage(client, botSettings, message);
    } catch (error) {
      console.error('[DISCORD] ❌ Error handling Discord message:', error);
    }
  });

  client.on('error', (error) => {
    console.error('❌ Discord client error:', error);
  });

  // Login
  try {
    await client.login(botSettings.discord.botToken);
    botInstances.set(botId, client);
    console.log(`✅ Discord bot started successfully for: ${botId}`);
    return client;
  } catch (error: any) {
    console.error(`❌ Error logging in Discord bot for ${botId}:`, error);
    return null;
  }
}

/**
 * Main function
 */
async function main() {
  console.log('🤖 Discord Worker Service Starting...');
  console.log('=====================================');

  try {
    await connectDB();
    console.log('✅ Database connected');

    // Find all enabled Discord bots
    const enabledBots = await BotSettings.find({
      'discord.enabled': true,
      'discord.botToken': { $exists: true, $ne: null }
    }).select('botId name discord').lean() as any[];

    if (enabledBots.length === 0) {
      console.log('⚠️ No enabled Discord bots found. Waiting for bots to be enabled...');
    } else {
      console.log(`✅ Found ${enabledBots.length} enabled Discord bot(s)`);
      
      // Start all enabled bots
      for (const bot of enabledBots) {
        try {
          await startBot(bot.botId);
        } catch (error) {
          console.error(`❌ Error starting bot ${bot.botId}:`, error);
        }
      }
    }

    // Refresh bot list every 30 seconds
    setInterval(async () => {
      try {
        const currentBots = Array.from(botInstances.keys());
        const enabledBots = await BotSettings.find({
          'discord.enabled': true,
          'discord.botToken': { $exists: true, $ne: null }
        }).select('botId').lean() as any[];

        const enabledBotIds = enabledBots.map(b => b.botId);

        // Start new bots
        for (const bot of enabledBots) {
          if (!botInstances.has(bot.botId)) {
            console.log(`🔄 Starting new Discord bot: ${bot.botId}`);
            await startBot(bot.botId);
          }
        }

        // Stop disabled bots
        for (const botId of currentBots) {
          if (!enabledBotIds.includes(botId)) {
            console.log(`🛑 Stopping disabled Discord bot: ${botId}`);
            const client = botInstances.get(botId);
            if (client) {
              client.destroy();
              botInstances.delete(botId);
            }
          }
        }
      } catch (error) {
        console.error('❌ Error refreshing bot list:', error);
      }
    }, 30000); // 30 seconds

    console.log('✅ Discord Worker Service is running');
    console.log('💡 Press Ctrl+C to stop');
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down Discord Worker Service...');
  
  for (const [botId, client] of botInstances.entries()) {
    try {
      client.destroy();
      console.log(`✅ Discord bot stopped: ${botId}`);
    } catch (error) {
      console.error(`❌ Error stopping bot ${botId}:`, error);
    }
  }
  
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  console.log('\n🛑 Shutting down Discord Worker Service...');
  
  for (const [botId, client] of botInstances.entries()) {
    try {
      client.destroy();
      console.log(`✅ Discord bot stopped: ${botId}`);
    } catch (error) {
      console.error(`❌ Error stopping bot ${botId}:`, error);
    }
  }
  
  await mongoose.connection.close();
  console.log('✅ MongoDB connection closed');
  process.exit(0);
});

// Start the service
main().catch((error) => {
  console.error('❌ Fatal error in main:', error);
  process.exit(1);
});

