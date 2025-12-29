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

// Alias for worker cache (same as botSettingsCache)
const workerBotSettings = botSettingsCache;

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
    channelTypeName: ChannelType[msg.channel.type] || `Unknown(${msg.channel.type})`,
    channelId: msg.channel.id,
    isDM: msg.channel.type === ChannelType.DM || msg.channel.type === ChannelType.GroupDM,
    author: msg.author.tag,
    authorId: msg.author.id,
    content: msg.content.substring(0, 50),
    mentions: msg.mentions.has(client.user!),
    isReply: msg.reference !== null,
    clientUserId: client.user?.id
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

  // Register event handlers BEFORE login to ensure they're active
  client.once('ready', async () => {
    console.log(`[DISCORD] ✅ Discord bot logged in as: ${client.user?.tag}`);
    console.log(`[DISCORD] 🆔 Bot ID: ${client.user?.id}`);
    console.log(`[DISCORD] ✅ Bot is ready and listening for messages`);
    
    // Verify intents are actually enabled
    const intents = client.options.intents;
    const intentsValue = intents ? Number(intents) : 0;
    console.log(`[DISCORD] 📊 Intents verification:`, {
      Guilds: !!(intentsValue & GatewayIntentBits.Guilds),
      GuildMessages: !!(intentsValue & GatewayIntentBits.GuildMessages),
      MessageContent: !!(intentsValue & GatewayIntentBits.MessageContent),
      DirectMessages: !!(intentsValue & GatewayIntentBits.DirectMessages),
      rawIntents: intentsValue.toString()
    });
    
    // CRITICAL: Check if MessageContent intent is enabled
    const hasMessageContent = !!(intentsValue & GatewayIntentBits.MessageContent);
    if (!hasMessageContent) {
      console.error(`[DISCORD] ❌❌❌ CRITICAL: MESSAGE CONTENT INTENT IS NOT ENABLED! ❌❌❌`);
      console.error(`[DISCORD] ❌ Bot will NOT receive message content without this intent!`);
      console.error(`[DISCORD] ❌ Go to Discord Developer Portal → Bot → Privileged Gateway Intents → Enable MESSAGE CONTENT INTENT`);
    } else {
      console.log(`[DISCORD] ✅ MESSAGE CONTENT INTENT is enabled`);
    }
    
    console.log(`[DISCORD] 👂 Bot is now actively listening for messageCreate events`);
    console.log(`[DISCORD] 🔍 Testing: Try sending a DM to ${client.user?.tag} now`);
    console.log(`[DISCORD] 🔍 Also try typing in DM (you should see typingStart event)`);
    
    // Test: Try to send a test message to verify bot can send messages
    try {
      // Get DMs channel if available
      const dms = client.channels.cache.filter(ch => ch.type === ChannelType.DM);
      if (dms.size > 0) {
        console.log(`[DISCORD] 📊 Found ${dms.size} DM channel(s) in cache`);
      }
    } catch (error) {
      console.error(`[DISCORD] ⚠️ Error checking DM channels:`, error);
    }
  });

  // Register messageCreate handler BEFORE login
  console.log(`[DISCORD] 📝 Registering messageCreate event handler...`);
  client.on('messageCreate', async (message) => {
    try {
      // Debug: Log ALL messages received (even from bots to verify events work)
      console.log(`[DISCORD] 🔔🔔🔔 messageCreate event triggered! 🔔🔔🔔`);
      console.log(`[DISCORD] 📨 Message details:`, {
        author: message.author.tag,
        authorId: message.author.id,
        authorIsBot: message.author.bot,
        channelType: message.channel.type,
        channelTypeName: ChannelType[message.channel.type] || `Unknown(${message.channel.type})`,
        channelId: message.channel.id,
        content: message.content || '(empty)',
        contentLength: message.content?.length || 0,
        guildId: message.guildId || 'DM',
        timestamp: new Date().toISOString()
      });
      
      // Only process non-bot messages
      if (!message.author.bot) {
        await handleMessage(client, botSettings, message);
      } else {
        console.log(`[DISCORD] ⏭️ Skipping bot message from: ${message.author.tag}`);
      }
    } catch (error) {
      console.error('[DISCORD] ❌ Error handling Discord message:', error);
      console.error('[DISCORD] ❌ Error stack:', error instanceof Error ? error.stack : String(error));
    }
  });
  console.log(`[DISCORD] ✅ messageCreate event handler registered`);
  
  // Add debug logging for other events to verify bot is receiving events
  // These events don't require MESSAGE CONTENT INTENT, so if we see these but not messageCreate,
  // it confirms MESSAGE CONTENT INTENT is the issue
  client.on('messageUpdate', (oldMessage, newMessage) => {
    console.log(`[DISCORD] 🔄 messageUpdate event: ${newMessage.author?.tag} in ${newMessage.channel.id}`);
  });
  
  client.on('typingStart', (typing) => {
    console.log(`[DISCORD] ⌨️⌨️⌨️ typingStart event received! ⌨️⌨️⌨️`);
    console.log(`[DISCORD] ⌨️ User: ${typing.user?.tag} is typing in channel: ${typing.channel.id}`);
    console.log(`[DISCORD] ⌨️ This event works WITHOUT MESSAGE CONTENT INTENT`);
  });
  
  // Log all raw events to see what Discord is sending
  client.on('raw', (event) => {
    if (event.t === 'MESSAGE_CREATE' || event.t === 'TYPING_START') {
      console.log(`[DISCORD] 📡 Raw event received: ${event.t}`, {
        type: event.t,
        timestamp: new Date().toISOString(),
        hasData: !!event.d,
        dataKeys: event.d ? Object.keys(event.d) : []
      });
      
      // If we receive MESSAGE_CREATE but messageCreate handler doesn't fire,
      // it means MESSAGE CONTENT INTENT is not enabled
      if (event.t === 'MESSAGE_CREATE') {
        console.log(`[DISCORD] ⚠️ Raw MESSAGE_CREATE received but messageCreate handler may not fire if MESSAGE CONTENT INTENT is disabled`);
        console.log(`[DISCORD] ⚠️ Check Discord Developer Portal → Bot → Privileged Gateway Intents → MESSAGE CONTENT INTENT`);
      }
    }
  });

  client.on('error', (error) => {
    console.error('[DISCORD] ❌ Discord client error:', error);
    console.error('[DISCORD] ❌ Error details:', {
      message: error.message,
      stack: error.stack,
      name: error.name
    });
  });

  client.on('warn', (warning) => {
    console.warn('[DISCORD] ⚠️ Discord client warning:', warning);
  });
  
  client.on('debug', (info) => {
    // Log important debug messages
    if (info.includes('message') || info.includes('MESSAGE') || info.includes('intent') || 
        info.includes('MESSAGE_CREATE') || info.includes('TYPING_START') ||
        info.includes('Gateway') || info.includes('WebSocket')) {
      console.log(`[DISCORD] 🔍 Debug: ${info}`);
    }
  });
  
  // Log when client connects/disconnects
  client.on('shardReady', (id) => {
    console.log(`[DISCORD] 🔌 Shard ${id} is ready`);
  });
  
  client.on('shardDisconnect', (event, id) => {
    console.error(`[DISCORD] ❌ Shard ${id} disconnected:`, event);
  });
  
  client.on('shardReconnecting', (id) => {
    console.log(`[DISCORD] 🔄 Shard ${id} is reconnecting`);
  });

  // Login AFTER registering all event handlers
  try {
    console.log(`[DISCORD] 🔐 Logging in with bot token...`);
    console.log(`[DISCORD] 📋 Registered event handlers: ready, messageCreate, error, warn`);
    console.log(`[DISCORD] ⏳ Waiting for bot to connect...`);
    
    await client.login(botSettings.discord.botToken);
    
    // Wait a bit for ready event to fire
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Check if bot is ready
    if (client.isReady()) {
      console.log(`[DISCORD] ✅ Bot is READY and connected`);
      console.log(`[DISCORD] 📊 Bot user: ${client.user?.tag} (${client.user?.id})`);
      console.log(`[DISCORD] 📊 Bot is in ${client.guilds.cache.size} server(s)`);
    } else {
      console.log(`[DISCORD] ⚠️ Bot logged in but not ready yet`);
    }
    
    botInstances.set(botId, client);
    console.log(`[DISCORD] ✅ Discord bot started successfully for: ${botId}`);
    console.log(`[DISCORD] 👂 Bot is now listening for messages...`);
    console.log(`[DISCORD] 💡 Send a DM to test: Bot should respond to messages`);
    console.log(`[DISCORD] 🔍 If no response, check MESSAGE CONTENT INTENT is enabled`);
    return client;
  } catch (error: any) {
    console.error(`[DISCORD] ❌ Error logging in Discord bot for ${botId}:`, error);
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

    // Refresh bot list every 15 seconds (reduced for faster updates)
    setInterval(async () => {
      try {
        console.log(`[DISCORD] 🔄 Refreshing bot list and checking for updates...`);
        const currentBots = Array.from(botInstances.keys());
        const enabledBots = await BotSettings.find({
          'discord.enabled': true,
          'discord.botToken': { $exists: true, $ne: null }
        }).select('botId name updatedAt').lean() as any[];

        const enabledBotIds = enabledBots.map(b => b.botId);

        // Start new bots or reload if settings changed
        for (const bot of enabledBots) {
          if (!botInstances.has(bot.botId)) {
            console.log(`[DISCORD] 🔄 Starting new Discord bot: ${bot.botId}`);
            await startBot(bot.botId);
          } else {
            // Check if bot settings were updated
            const cached = workerBotSettings.get(bot.botId);
            const dbUpdatedAt = new Date(bot.updatedAt).getTime();
            const cacheUpdatedAt = cached?.settings?.updatedAt ? new Date(cached.settings.updatedAt).getTime() : 0;
            
            if (dbUpdatedAt > cacheUpdatedAt) {
              console.log(`[DISCORD] 🔄 Bot settings updated for ${bot.botId}, reloading...`);
              console.log(`[DISCORD]    Cache: ${new Date(cacheUpdatedAt).toISOString()}, DB: ${new Date(dbUpdatedAt).toISOString()}`);
              
              // Clear cache and reload
              workerBotSettings.delete(bot.botId);
              
              // Restart bot to load new settings
              const client = botInstances.get(bot.botId);
              if (client) {
                console.log(`[DISCORD] 🔄 Restarting bot ${bot.botId} to load new settings...`);
                await client.destroy();
                botInstances.delete(bot.botId);
                await startBot(bot.botId);
              }
            }
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

