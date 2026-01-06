/**
 * Standalone Telegram Bot Worker
 * 
 * This worker runs independently and uses Telegram Bot API with long polling
 * to receive and process messages directly, without relying on Vercel webhooks.
 * 
 * Deploy this on Railway, Render, DigitalOcean, or any Node.js hosting service.
 * 
 * Usage:
 *   npm run worker:telegram
 *   or
 *   tsx scripts/telegram-worker.ts
 */

import TelegramBot from 'node-telegram-bot-api';
import mongoose from 'mongoose';
import BotSettings from '../lib/models/BotSettings';
import Message from '../lib/models/Message';
import { processChatMessage } from '../lib/services/chatService';

// Environment variables
const MONGODB_URI = process.env.MONGODB_URI;
const MONGODB_DB = process.env.MONGODB_DB || 'chatbotdb';
const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const POLLING_INTERVAL = 1000; // 1 second

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

// Store active bot instances
const botInstances = new Map<string, TelegramBot>();

/**
 * Connect to MongoDB
 */
async function connectDB() {
  try {
    if (mongoose.connection.readyState === 1) {
      const dbName = mongoose.connection.db?.databaseName || 'unknown';
      console.log(`📊 Already connected to MongoDB. Database: ${dbName}`);
      
      // List collections
      try {
        const collections = await mongoose.connection.db?.listCollections().toArray();
        const collectionNames = collections?.map((c: any) => c.name).join(', ') || 'none';
        console.log(`   Collections: ${collectionNames}`);
      } catch (err) {
        console.log(`   Collections: (unable to list)`);
      }
      
      return mongoose.connection;
    }

    console.log(`🔌 Connecting to MongoDB...`);
    const uriPreview = MONGODB_URI ? `${MONGODB_URI.substring(0, 30)}...` : 'not set';
    console.log(`   URI preview: ${uriPreview}`);
    console.log(`   Note: Using default database from URI (same as Vercel app)`);

    // KHÔNG dùng dbName option - để MongoDB tự detect database từ URI hoặc dùng default
    // Giống như Vercel app (lib/db.ts) để đảm bảo cùng database
    await mongoose.connect(MONGODB_URI!, {
      // dbName: MONGODB_DB,  // REMOVED - use same database as Vercel app
      bufferCommands: false,
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
    });

    const dbName = mongoose.connection.db?.databaseName || 'unknown';
    console.log(`✅ Connected to MongoDB`);
    console.log(`   Active database: ${dbName}`);
    
    // List collections with error handling
    try {
      const collections = await mongoose.connection.db?.listCollections().toArray();
      const collectionNames = collections?.map((c: any) => c.name).join(', ') || 'none';
      console.log(`   Collections: ${collectionNames}`);
    } catch (err) {
      console.log(`   Collections: (unable to list - ${err instanceof Error ? err.message : String(err)})`);
    }
    
    return mongoose.connection;
  } catch (error) {
    console.error('❌ MongoDB connection error:', error);
    throw error;
  }
}

/**
 * Get bot settings from database
 */
async function getBotSettings(botId?: string): Promise<any | null> {
  await connectDB();

  if (botId) {
    const normalizedBotId = botId.trim();
    const cacheKey = `telegram_${normalizedBotId}`;
    const cached = botSettingsCache.get(cacheKey);
    
    // Check cache validity - also reload if cache is older than 30 seconds to catch recent updates
    if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
      const cacheAge = Date.now() - cached.timestamp;
      if (cacheAge > 30000) { // 30 seconds - reload to catch recent document additions
        console.log(`🔄 Cache is ${Math.round(cacheAge / 1000)}s old, reloading bot settings for: ${normalizedBotId}`);
      } else {
        return cached.settings;
      }
    }

    const botSettings = await BotSettings.findOne({
      botId: normalizedBotId,
      'telegram.enabled': true,
      'telegram.botToken': { $exists: true }
    }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;

    if (botSettings) {
      botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
      console.log(`✅ Loaded bot settings from DB for: ${normalizedBotId} (${botSettings.documents?.length || 0} documents)`);
    }

    return botSettings;
  }

  // Get first enabled bot
  const bots = await BotSettings.find({
    'telegram.enabled': true,
    'telegram.botToken': { $exists: true }
  }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

  return bots.length > 0 ? bots[0] : null;
}

/**
 * Send typing indicator
 */
async function sendTypingIndicator(bot: TelegramBot, chatId: number): Promise<void> {
  try {
    await bot.sendChatAction(chatId, 'typing');
  } catch (error) {
    // Ignore typing indicator errors
  }
}

/**
 * Send message with retry logic
 */
async function sendMessage(
  bot: TelegramBot,
  chatId: number,
  message: string,
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message> {
  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await bot.sendMessage(chatId, message, {
        ...options,
        parse_mode: 'HTML'
      });
      return result;
    } catch (error: any) {
      lastError = error;
      const errorCode = error.code || error.response?.statusCode;

      if (errorCode === 400 || errorCode === 401 || errorCode === 403 || errorCode === 404) {
        throw error;
      }

      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  throw lastError || new Error('Failed to send Telegram message');
}

/**
 * Handle incoming message
 */
async function handleMessage(bot: TelegramBot, botSettings: any, message: TelegramBot.Message) {
  const chatId = message.chat.id;
  let text = message.text || '';
  const userId = message.from?.id.toString();

  console.log(`🤖 [TELEGRAM] [${new Date().toISOString()}] Processing message for bot ${botSettings.botId}:`, {
    chatId,
    text: text.substring(0, 100),
    textLength: text.length,
    chatType: message.chat.type,
    from: message.from?.username || message.from?.id,
    messageId: message.message_id
  });
  
  // Ensure we always log when entering this function
  console.log(`📍 [TELEGRAM] handleMessage function called - botId: ${botSettings.botId}, chatId: ${chatId}, hasText: ${!!text}`);

  // Handle /start command
  if (text === '/start') {
    try {
      await sendMessage(
        bot,
        chatId,
        botSettings.welcomeMessage || `Xin chào! Tôi là ${botSettings.name}. Tôi có thể giúp gì cho bạn?`
      );
      return;
    } catch (error) {
      console.error('❌ Error sending welcome message:', error);
      return;
    }
  }

  // Ignore empty messages
  if (!text.trim()) {
    return;
  }

  // Ignore group messages unless bot is mentioned
  if (message.chat.type !== 'private') {
    const botUsername = botSettings.telegram.botUsername;
    if (botUsername && !text.includes(`@${botUsername}`)) {
      return;
    }
    text = text.replace(`@${botUsername}`, '').trim();
  }

  // Send typing indicator
  sendTypingIndicator(bot, chatId).catch(() => {});

  const typingInterval = setInterval(() => {
    sendTypingIndicator(bot, chatId).catch(() => {});
  }, 2000);

  try {
    // Process with AI
    console.log(`🤖 [TELEGRAM] Processing message with AI: "${text.substring(0, 100)}"`);
    
    // Debug: Check bot settings data
    console.log(`📋 [TELEGRAM] Bot settings check for ${botSettings.botId}:`);
    console.log(`   Bot Name: ${botSettings.name}`);
    console.log(`   FAQs count: ${botSettings.faqs?.length || 0}`);
    console.log(`   Documents count: ${botSettings.documents?.filter((d: any) => d.enabled)?.length || 0}`);
    console.log(`   URLs count: ${botSettings.urls?.filter((u: any) => u.enabled)?.length || 0}`);
    console.log(`   Structured data count: ${botSettings.structuredData?.filter((s: any) => s.enabled)?.length || 0}`);
    
    // Add timeout wrapper to ensure we always respond
    const reply = await Promise.race([
      processChatMessage(
        botSettings,
        text,
        OPENAI_API_KEY!,
        'telegram'
      ),
      // Fallback timeout - if AI takes too long, send a default message
      new Promise<string>((resolve) => 
        setTimeout(() => {
          console.warn(`⚠️ [TELEGRAM] AI processing timeout, sending default response`);
          resolve('Xin lỗi, tôi đang xử lý yêu cầu của bạn. Vui lòng đợi một chút...');
        }, 18000) // 18 seconds timeout
      )
    ]);

    clearInterval(typingInterval);
    console.log(`✅ [TELEGRAM] AI reply generated (${reply.length} chars): "${reply.substring(0, 100)}..."`);

    // Format reply for Telegram HTML
    const { formatTelegramMessage } = await import('../lib/utils/telegramFormatter');
    const formattedReply = formatTelegramMessage(reply);

    // Send reply with retry
    console.log(`📤 [TELEGRAM] [${new Date().toISOString()}] Attempting to send reply (${reply.length} chars) to chatId: ${chatId}`);
    try {
      const sentMessage = await sendMessage(bot, chatId, formattedReply);
      console.log(`✅ [TELEGRAM] [${new Date().toISOString()}] Reply sent successfully! Message ID: ${sentMessage.message_id}, chatId: ${chatId}`);
    } catch (sendError: any) {
      console.error(`❌ [TELEGRAM] [${new Date().toISOString()}] Error sending reply to chatId ${chatId}:`, sendError);
      console.error(`   Error type: ${sendError.constructor?.name || typeof sendError}`);
      console.error(`   Error message: ${sendError.message || String(sendError)}`);
      console.error(`   Error code: ${sendError.code || 'N/A'}`);
      // Try to send a simpler error message
      try {
        console.log(`🔄 [TELEGRAM] Attempting to send fallback error message...`);
        const fallbackMsg = await bot.sendMessage(chatId, 'Xin lỗi, tôi gặp sự cố khi gửi phản hồi. Vui lòng thử lại sau.');
        console.log(`✅ [TELEGRAM] Fallback message sent: ${fallbackMsg.message_id}`);
      } catch (fallbackError: any) {
        console.error(`❌ [TELEGRAM] Failed to send fallback message:`, fallbackError);
        console.error(`   Fallback error type: ${fallbackError.constructor?.name || typeof fallbackError}`);
        console.error(`   Fallback error message: ${fallbackError.message || String(fallbackError)}`);
      }
      throw sendError; // Re-throw to be caught by outer catch
    }

    // Track message asynchronously
    setImmediate(async () => {
      try {
        const messageRecord = new Message({
          userId: botSettings.userId,
          botId: botSettings.botId,
          message: text,
          response: reply,
          timestamp: new Date(),
          sessionId: `telegram_${chatId}`
        });
        await messageRecord.save();
        console.log('✅ Message tracked in database');
      } catch (trackingError) {
        console.error('⚠️ Error tracking message:', trackingError);
      }
    });
  } catch (error: any) {
    clearInterval(typingInterval);
    console.error('❌ [TELEGRAM] Error processing message:', error);
    console.error('   Error type:', error.constructor.name);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);

    // Always try to send an error message to user
    const errorMsg = error.message?.includes('timeout')
      ? 'Xin lỗi, yêu cầu của bạn mất quá nhiều thời gian để xử lý. Vui lòng thử lại sau.'
      : error.message?.includes('Rate limit')
      ? 'Xin lỗi, hệ thống đang quá tải. Vui lòng thử lại sau vài giây.'
      : 'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.';

    // Try multiple times to send error message
    let sent = false;
    for (let attempt = 1; attempt <= 3 && !sent; attempt++) {
      try {
        await bot.sendMessage(chatId, errorMsg);
        console.log(`✅ [TELEGRAM] Error message sent to user (attempt ${attempt})`);
        sent = true;
      } catch (sendError: any) {
        console.error(`❌ [TELEGRAM] Failed to send error message (attempt ${attempt}):`, sendError);
        if (attempt < 3) {
          await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second before retry
        }
      }
    }
    
    if (!sent) {
      console.error('❌ [TELEGRAM] Could not send error message to user after 3 attempts');
    }
  }
}

/**
 * Initialize and start bot with polling
 */
async function startBot(botSettings: any) {
  const token = botSettings.telegram.botToken;
  if (!token) {
    console.error(`❌ Bot ${botSettings.botId} has no token`);
    return null;
  }

  // Check if bot instance already exists
  if (botInstances.has(token)) {
    return botInstances.get(token)!;
  }

  console.log(`🚀 Starting bot: ${botSettings.name} (${botSettings.botId})`);

  // Create bot instance with polling enabled
  // Increased timeout and better error handling for network issues
  const bot = new TelegramBot(token, {
    polling: {
      interval: POLLING_INTERVAL,
      autoStart: false,
      params: {
        timeout: 30, // Increased from 10 to 30 seconds for better reliability
      }
    }
  });

  // Set up message handler with better logging
  bot.on('message', async (msg) => {
    const timestamp = new Date().toISOString();
    try {
      console.log(`📨 [TELEGRAM] [${timestamp}] Message received for bot ${botSettings.botId}:`, {
        chatId: msg.chat.id,
        chatType: msg.chat.type,
        text: msg.text || '(no text)',
        from: msg.from?.username || msg.from?.id,
        messageId: msg.message_id,
        hasText: !!msg.text
      });
      
      // Log immediately that we're processing
      console.log(`🔄 [TELEGRAM] [${timestamp}] Starting to process message...`);
      
      await handleMessage(bot, botSettings, msg);
      
      console.log(`✅ [TELEGRAM] [${timestamp}] Message processing completed`);
    } catch (error) {
      console.error(`❌ [TELEGRAM] [${timestamp}] Error in message handler:`, error);
      console.error('   Error type:', error instanceof Error ? error.constructor.name : typeof error);
      console.error('   Error message:', error instanceof Error ? error.message : String(error));
      console.error('   Error stack:', error instanceof Error ? error.stack : 'No stack trace');
      
      // Try to send error notification to user
      try {
        await bot.sendMessage(msg.chat.id, 'Xin lỗi, tôi gặp lỗi khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.');
        console.log(`✅ [TELEGRAM] Error notification sent to user`);
      } catch (sendError) {
        console.error(`❌ [TELEGRAM] Could not send error notification:`, sendError);
      }
    }
  });
  
  // Also listen for text messages specifically
  bot.on('text', async (msg) => {
    console.log(`📝 [TELEGRAM] Text message event received: "${msg.text}" (chatId: ${msg.chat.id})`);
  });
  
  // Listen for all updates to see what's happening
  bot.on('polling_error', (error) => {
    console.error(`❌ [TELEGRAM] Polling error detected:`, error);
  });
  
  // Log when bot is ready
  console.log(`✅ [TELEGRAM] Event handlers registered for bot ${botSettings.botId}`);

  // Set up error handler
  bot.on('error', (error: any) => {
    const errorCode = error.code || error.response?.statusCode || (error.response?.data?.error_code);
    let errorMessage = error.message || error.description || String(error);
    
    // Clean up error message - remove any duplicate prefixes
    if (typeof errorMessage === 'string') {
      errorMessage = errorMessage.replace(/\[TELEGRAM\]\s*/g, '').trim();
    }
    
    // Don't log timeout errors as critical - they're network issues
    const isTimeout = errorCode === 'ETIMEDOUT' || 
                      errorMessage.includes('ETIMEDOUT') || 
                      errorMessage.includes('timeout');
    
    if (isTimeout) {
      console.warn(`⚠️ [TELEGRAM] Connection timeout (will retry): ${errorMessage}`);
      return;
    }
    
    // Log other errors
    console.error('❌ [TELEGRAM] Bot error:', {
      code: errorCode,
      message: errorMessage,
      botId: botSettings.botId
    });
  });

  // Set up polling error handler (specific to polling errors)
  bot.on('polling_error', (error: any) => {
    // Extract error information more carefully
    const errorCode = error.code || error.response?.statusCode || (error.response?.data?.error_code);
    let errorMessage = error.message || error.description || String(error);
    
    // Clean up error message - remove any duplicate prefixes or formatting
    if (typeof errorMessage === 'string') {
      // Remove duplicate [TELEGRAM] prefixes if present
      errorMessage = errorMessage.replace(/\[TELEGRAM\]\s*/g, '').trim();
      // Extract just the core error message
      if (errorMessage.includes('EFATAL:')) {
        errorMessage = errorMessage.split('EFATAL:').pop()?.trim() || errorMessage;
      }
    }
    
    // Handle timeout errors gracefully
    const isTimeout = errorCode === 'EFATAL' || 
                      errorCode === 'ETIMEDOUT' || 
                      errorMessage.includes('ETIMEDOUT') || 
                      errorMessage.includes('timeout') ||
                      errorMessage.includes('ETIMEDOUT');
    
    if (isTimeout) {
      // Only log timeout errors at warning level, not as critical errors
      console.warn(`⚠️ [TELEGRAM] Polling timeout (will retry automatically): ${errorMessage}`);
      // The library will automatically retry, so we don't need to do anything
      return;
    }
    
    // Log other polling errors
    console.error('❌ [TELEGRAM] Polling error:', {
      code: errorCode,
      message: errorMessage,
      botId: botSettings.botId
    });
    
    // For non-timeout errors, try to restart polling after a delay
    if (!isTimeout) {
      setTimeout(async () => {
        try {
          console.log(`🔄 [TELEGRAM] Attempting to restart polling for bot: ${botSettings.botId}`);
          await bot.stopPolling();
          await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
          await bot.startPolling();
          console.log(`✅ [TELEGRAM] Polling restarted for bot: ${botSettings.botId}`);
        } catch (restartError) {
          console.error(`❌ [TELEGRAM] Failed to restart polling:`, restartError);
        }
      }, 10000); // Retry after 10 seconds
    }
  });

  // Start polling with better error handling and verification
  try {
    console.log(`🔄 [TELEGRAM] Starting polling for bot: ${botSettings.botId} (${botSettings.name})...`);
    await bot.startPolling();
    console.log(`✅ [TELEGRAM] Bot ${botSettings.name} is now polling for messages`);
    
    // Verify bot is working by getting bot info
    try {
      const botInfo = await bot.getMe();
      console.log(`✅ [TELEGRAM] Bot verified: @${botInfo.username} (${botInfo.id})`);
    } catch (infoError) {
      console.warn(`⚠️ [TELEGRAM] Could not verify bot info:`, infoError);
    }
  } catch (error: any) {
    const errorMessage = error.message || String(error);
    console.error(`❌ [TELEGRAM] Failed to start polling for bot ${botSettings.botId}:`, error);
    console.error(`   Error message: ${errorMessage}`);
    console.error(`   Error code: ${error.code || 'N/A'}`);
    
    if (errorMessage.includes('ETIMEDOUT') || errorMessage.includes('timeout')) {
      console.warn(`⚠️ [TELEGRAM] Initial polling timeout (will retry in 5 seconds)...`);
      // Retry after delay
      setTimeout(async () => {
        try {
          console.log(`🔄 [TELEGRAM] Retrying to start polling for bot: ${botSettings.botId}...`);
          await bot.startPolling();
          console.log(`✅ [TELEGRAM] Bot ${botSettings.name} polling started after retry`);
        } catch (retryError) {
          console.error(`❌ [TELEGRAM] Failed to start polling after retry:`, retryError);
        }
      }, 5000);
    } else {
      // For other errors, still try to retry once
      setTimeout(async () => {
        try {
          console.log(`🔄 [TELEGRAM] Retrying to start polling (second attempt)...`);
          await bot.startPolling();
          console.log(`✅ [TELEGRAM] Bot ${botSettings.name} polling started after second retry`);
        } catch (retryError) {
          console.error(`❌ [TELEGRAM] Failed to start polling after second retry:`, retryError);
        }
      }, 10000);
    }
  }

  botInstances.set(token, bot);
  console.log(`✅ Bot ${botSettings.name} is now polling for messages`);

  return bot;
}

/**
 * Main function
 */
async function main() {
  console.log('🚀 Starting Telegram Worker Service...');
  console.log('📋 Configuration:');
  console.log(`   - MongoDB: ${MONGODB_URI ? 'Configured' : 'Missing'}`);
  console.log(`   - OpenAI API: ${OPENAI_API_KEY ? 'Configured' : 'Missing'}`);
  console.log(`   - Polling interval: ${POLLING_INTERVAL}ms`);

  // Connect to database
  await connectDB();

  // Debug: Check all bots first
  const allBots = await BotSettings.find({}).select('botId name telegram').lean() as any[];
  console.log(`📋 Total bots in database: ${allBots.length}`);
  allBots.forEach((bot, index) => {
    console.log(`   ${index + 1}. Bot: "${bot.botId}"`);
    console.log(`      Name: ${bot.name}`);
    console.log(`      Telegram enabled: ${bot.telegram?.enabled || false}`);
    console.log(`      Has token: ${!!bot.telegram?.botToken}`);
    console.log(`      Token length: ${bot.telegram?.botToken?.length || 0}`);
  });

  // Get all enabled bots
  const bots = await BotSettings.find({
    'telegram.enabled': true,
    'telegram.botToken': { $exists: true }
  }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

  console.log(`🔍 Query result: Found ${bots.length} enabled bot(s) with token`);

  if (bots.length === 0) {
    console.warn('⚠️ No enabled Telegram bots found in database');
    console.log('💡 Please enable at least one bot in the dashboard');
    console.log('🔄 Will retry in 30 seconds...');
    
    // Retry sau 30 giây thay vì exit
    setTimeout(() => {
      console.log('🔄 Retrying to find enabled bots...');
      main().catch((error) => {
        console.error('❌ Fatal error:', error);
        setTimeout(() => main(), 30000);
      });
    }, 30000);
    return;
  }

  console.log(`✅ Found ${bots.length} enabled bot(s)`);

  // Start all bots
  for (const botSettings of bots) {
    try {
      await startBot(botSettings);
    } catch (error) {
      console.error(`❌ Failed to start bot ${botSettings.botId}:`, error);
    }
  }

  // Refresh bot list every 5 minutes
  setInterval(async () => {
    try {
      const updatedBots = await BotSettings.find({
        'telegram.enabled': true,
        'telegram.botToken': { $exists: true }
      }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

      // Start new bots
      for (const botSettings of updatedBots) {
        if (!botInstances.has(botSettings.telegram.botToken)) {
          console.log(`🆕 Found new bot: ${botSettings.name}`);
          await startBot(botSettings);
        }
      }

      // Clear cache
      botSettingsCache.clear();
    } catch (error) {
      console.error('❌ Error refreshing bot list:', error);
    }
  }, 5 * 60 * 1000); // 5 minutes

  console.log('✅ Telegram Worker Service is running');
  console.log('💡 Press Ctrl+C to stop');
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\n🛑 Shutting down gracefully...');
  
  // Stop all bots
  const bots = Array.from(botInstances.values());
  for (const bot of bots) {
    try {
      bot.stopPolling();
    } catch (error) {
      console.error('Error stopping bot:', error);
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

