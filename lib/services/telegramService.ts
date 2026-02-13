import TelegramBot from 'node-telegram-bot-api';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import Message from '@/lib/models/Message';
import { processChatMessage } from './chatService';

// Store active bot instances
const botInstances = new Map<string, TelegramBot>();

// Cache for bot settings to reduce database queries
const botSettingsCache = new Map<string, { settings: any; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

/**
 * Initialize or get Telegram bot instance
 */
export function getTelegramBot(token: string): TelegramBot {
  if (botInstances.has(token)) {
    return botInstances.get(token)!;
  }

  // Configure bot with polling disabled (we use webhooks)
  const bot = new TelegramBot(token, { polling: false });

  // Set request timeout via bot's internal request method
  // Note: node-telegram-bot-api uses request-promise internally
  // We'll handle timeout in sendTelegramMessage with retry logic instead
  botInstances.set(token, bot);
  return bot;
}

/**
 * Set webhook for Telegram bot
 */
export async function setTelegramWebhook(
  token: string,
  webhookUrl: string
): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    const bot = getTelegramBot(token);
    const result = await bot.setWebHook(webhookUrl);

    // Check if Telegram API returned an error
    if (result === false) {
      return {
        success: false,
        error: 'Telegram API returned false',
        details: 'The webhook URL might be invalid or unreachable'
      };
    }

    // Telegram API returns true on success, or an object with ok: true
    if (result === true || (typeof result === 'object' && result.ok === true)) {
      return { success: true };
    }

    // If result is an object with ok: false, it contains error details
    if (typeof result === 'object' && result.ok === false) {
      return {
        success: false,
        error: result.description || 'Failed to set webhook',
        details: result
      };
    }

    return { success: true };
  } catch (error: any) {
    console.error('Error setting Telegram webhook:', error);
    return {
      success: false,
      error: error.message || 'Failed to set webhook',
      details: error.response?.data || error
    };
  }
}

/**
 * Get Telegram bot info
 */
export async function getTelegramBotInfo(token: string) {
  try {
    const bot = getTelegramBot(token);
    const me = await bot.getMe();
    return {
      id: me.id,
      username: me.username || '',
      firstName: me.first_name || '',
      canJoinGroups: (me as any).can_join_groups,
      canReadAllGroupMessages: (me as any).can_read_all_group_messages,
      supportsInlineQueries: (me as any).supports_inline_queries
    };
  } catch (error) {
    console.error('Error getting Telegram bot info:', error);
    throw error;
  }
}

/**
 * Delete webhook for Telegram bot
 */
export async function deleteTelegramWebhook(token: string): Promise<boolean> {
  try {
    const bot = getTelegramBot(token);
    await bot.deleteWebHook();
    return true;
  } catch (error) {
    console.error('Error deleting Telegram webhook:', error);
    return false;
  }
}

/**
 * Invalidate bot settings cache (call this when bot settings are updated)
 */
export function invalidateBotSettingsCache(botId?: string): void {
  if (botId) {
    const cacheKey = `telegram_${botId.trim()}`;
    botSettingsCache.delete(cacheKey);
    console.log(`🗑️ Invalidated cache for bot: ${botId}`);
  } else {
    // Clear all cache
    botSettingsCache.clear();
    console.log('🗑️ Cleared all bot settings cache');
  }
}

/**
 * Send typing indicator to show bot is processing
 */
export async function sendTypingIndicator(token: string, chatId: number): Promise<void> {
  try {
    const bot = getTelegramBot(token);
    await bot.sendChatAction(chatId, 'typing');
  } catch (error) {
    // Ignore typing indicator errors - not critical
    console.warn('⚠️ Failed to send typing indicator:', error);
  }
}

/**
 * Send message via Telegram bot with retry logic
 */
export async function sendTelegramMessage(
  token: string,
  chatId: number,
  message: string,
  options?: TelegramBot.SendMessageOptions
): Promise<TelegramBot.Message> {
  const bot = getTelegramBot(token);
  const maxRetries = 3;
  let lastError: any = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📤 Sending Telegram message (attempt ${attempt}/${maxRetries})...`);
      const result = await bot.sendMessage(chatId, message, {
        ...options,
        parse_mode: options?.parse_mode || 'HTML' // Support HTML formatting
      });
      console.log(`✅ Telegram message sent successfully`);
      return result;
    } catch (error: any) {
      lastError = error;
      const errorCode = error.code || error.response?.statusCode;
      const errorMessage = error.message || String(error);

      console.error(`❌ Telegram send error (attempt ${attempt}/${maxRetries}):`, {
        code: errorCode,
        message: errorMessage,
        chatId,
        messageLength: message.length
      });

      // Don't retry on certain errors
      if (errorCode === 400 || errorCode === 401 || errorCode === 403 || errorCode === 404) {
        console.error('❌ Non-retryable error, stopping retries');
        throw error;
      }

      // If not last attempt, wait before retrying
      if (attempt < maxRetries) {
        const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000); // Exponential backoff, max 5s
        console.log(`⏳ Waiting ${waitTime}ms before retry...`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
      }
    }
  }

  // All retries failed
  console.error(`❌ Failed to send Telegram message after ${maxRetries} attempts`);
  throw lastError || new Error('Failed to send Telegram message');
}

/**
 * Handle incoming Telegram message
 */
export async function handleTelegramMessage(update: TelegramBot.Update, botId?: string) {
  if (!update.message) {
    console.log('⚠️ Telegram update has no message, skipping');
    return;
  }

  const message = update.message;
  const chatId = message.chat.id;
  let text = message.text || '';
  const userId = message.from?.id.toString();

  console.log(`🤖 Processing Telegram message: chatId=${chatId}, text="${text}", botId=${botId || 'not provided'}`);

  // Connect to DB
  await connectDB();

  let botSettings: any = null;

  if (botId) {
    // Normalize botId (trim and handle encoding issues)
    const normalizedBotId = botId.trim();
    console.log(`🔍 Looking for bot with botId: "${normalizedBotId}"`);

    // Check cache first
    const cacheKey = `telegram_${normalizedBotId}`;
    const cached = botSettingsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
      console.log(`✅ Using cached bot settings for: ${normalizedBotId}`);
      botSettings = cached.settings;
    } else {
      // Strategy 1: Try exact match with telegram.enabled - USE LEAN() to get plain object
      // Use select() to only fetch needed fields for faster queries
      botSettings = await BotSettings.findOne({
        botId: normalizedBotId,
        'telegram.enabled': true,
        'telegram.botToken': { $exists: true }
      }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;

      // Cache the result if found
      if (botSettings) {
        botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
      }
    }

    // Strategy 2: If not found, try exact match without enabled check (bot might not be enabled yet)
    if (!botSettings) {
      console.log(`⚠️ Not found with enabled=true, trying without enabled check...`);
      botSettings = await BotSettings.findOne({
        botId: normalizedBotId,
        'telegram.botToken': { $exists: true }
      }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;

      if (botSettings) {
        console.log(`⚠️ Found bot but telegram.enabled=${botSettings.telegram?.enabled || false}`);
        // Cache the result
        botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
        // Still use it but warn
      }
    }

    // Strategy 3: Try case-insensitive search
    if (!botSettings) {
      console.log(`⚠️ Exact match not found, trying case-insensitive search...`);
      const allBots = await BotSettings.find({
        'telegram.botToken': { $exists: true }
      }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

      botSettings = allBots.find(bot =>
        bot.botId.trim().toLowerCase() === normalizedBotId.toLowerCase()
      ) || null;

      if (botSettings) {
        console.log(`✅ Found bot with case-insensitive match: ${botSettings.name} (${botSettings.botId})`);
        console.log(`   Original: "${botSettings.botId}"`);
        console.log(`   Looking for: "${normalizedBotId}"`);
        // Cache the result
        botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
      }
    }

    if (botSettings) {
      console.log(`✅ Found bot: ${botSettings.name} (${botSettings.botId})`);
      console.log(`   BotId match: "${botSettings.botId}" === "${normalizedBotId}"`);
      console.log(`   Telegram enabled: ${botSettings.telegram?.enabled || false}`);
      console.log(`   Has telegram token: ${!!botSettings.telegram?.botToken}`);
      console.log(`   Telegram data:`, JSON.stringify(botSettings.telegram || {}, null, 2));
      console.log(`   Telegram type: ${typeof botSettings.telegram}`);

      // If bot found but no token, warn but still try to use it
      if (!botSettings.telegram?.botToken) {
        console.warn(`⚠️ WARNING: Bot found but no telegram token! Bot may not be configured yet.`);
        console.warn(`   Please go to dashboard and activate Telegram bot for this bot.`);
        console.warn(`   Full botSettings keys:`, Object.keys(botSettings));
        return; // Can't process without token
      }

      console.log(`✅✅✅ Bot has telegram token, proceeding to process message...`);
    } else {
      console.log(`❌ Bot not found with botId: "${normalizedBotId}"`);

      // List ALL bots for debugging - USE LEAN() to get plain objects
      const allBots = await BotSettings.find({}).lean() as any[];
      console.log(`   📋 All bots in database (${allBots.length}):`);
      allBots.forEach((bot, index) => {
        console.log(`      ${index + 1}. "${bot.botId}" (name: ${bot.name})`);
        console.log(`         Has telegram token: ${!!bot.telegram?.botToken}`);
        console.log(`         Telegram enabled: ${bot.telegram?.enabled || false}`);
      });

      // Also check bots with telegram token
      const botsWithToken = await BotSettings.find({ 'telegram.botToken': { $exists: true } }).lean() as any[];
      console.log(`   📋 Bots with telegram token (${botsWithToken.length}):`);
      botsWithToken.forEach((bot, index) => {
        console.log(`      ${index + 1}. "${bot.botId}" (enabled: ${bot.telegram?.enabled || false})`);
      });
    }
  } else {
    // Fallback: find by matching bot token from update - USE LEAN() to get plain objects
    console.log('🔍 No botId provided, searching for enabled bots...');

    // Check cache for "first_enabled_bot"
    const fallbackCacheKey = 'telegram_first_enabled';
    const cachedFallback = botSettingsCache.get(fallbackCacheKey);
    if (cachedFallback && Date.now() - cachedFallback.timestamp < BOT_SETTINGS_CACHE_TTL) {
      console.log(`✅ Using cached first enabled bot`);
      botSettings = cachedFallback.settings;
    } else {
      const bots = await BotSettings.find({
        'telegram.enabled': true,
        'telegram.botToken': { $exists: true }
      }).select('botId name userId telegram welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];

      console.log(`Found ${bots.length} enabled Telegram bot(s)`);

      if (bots.length > 0) {
        bots.forEach((bot, index) => {
          console.log(`   Bot ${index + 1}: "${bot.botId}" (${bot.name})`);
        });
        // Use first enabled bot
        botSettings = bots[0];
        console.log(`✅ Using first enabled bot: ${botSettings.name} (${botSettings.botId})`);
        // Cache the result
        botSettingsCache.set(fallbackCacheKey, { settings: botSettings, timestamp: Date.now() });
      } else {
        // Try to find any bot with telegram token (even if not enabled)
        const anyBots = await BotSettings.find({ 'telegram.botToken': { $exists: true } }).lean() as any[];
        console.log(`⚠️ No enabled bots found. Found ${anyBots.length} bot(s) with telegram token:`);
        anyBots.forEach(bot => {
          console.log(`   - "${bot.botId}" (enabled: ${bot.telegram?.enabled || false})`);
        });
        if (anyBots.length > 0) {
          botSettings = anyBots[0];
          botSettingsCache.set(fallbackCacheKey, { settings: botSettings, timestamp: Date.now() });
        }
      }
    }
  }

  // Clean up old cache entries (keep only last 50)
  if (botSettingsCache.size > 50) {
    const entries = Array.from(botSettingsCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    const toKeep = entries.slice(0, 50);
    botSettingsCache.clear();
    toKeep.forEach(([key, value]) => botSettingsCache.set(key, value));
  }

  if (!botSettings || !botSettings.telegram?.botToken) {
    console.error('❌ Telegram bot not found or not configured');
    console.error('Bot settings:', botSettings ? 'Found but missing telegram config' : 'Not found');
    return;
  }

  // Handle /start command
  if (text === '/start') {
    console.log(`📝 Handling /start command for chatId: ${chatId}`);
    try {
      await sendTelegramMessage(
        botSettings.telegram.botToken,
        chatId,
        botSettings.welcomeMessage || `Xin chào! Tôi là ${botSettings.name}. Tôi có thể giúp gì cho bạn?`
      );
      console.log('✅ Welcome message sent');
    } catch (error: any) {
      console.error('❌ Error sending welcome message:', error);
      // Try to send error notification to user if possible
      try {
        await sendTelegramMessage(
          botSettings.telegram.botToken,
          chatId,
          'Xin lỗi, tôi đang gặp sự cố kỹ thuật. Vui lòng thử lại sau.'
        ).catch(() => {
          // Ignore if this also fails
        });
      } catch {
        // Ignore
      }
    }
    return;
  }

  // Ignore empty messages
  if (!text.trim()) {
    console.log('⚠️ Empty message, skipping');
    return;
  }

  // Ignore group messages unless bot is mentioned
  if (message.chat.type !== 'private') {
    const botUsername = botSettings.telegram.botUsername;
    if (botUsername && !text.includes(`@${botUsername}`)) {
      return;
    }
    // Remove bot mention from text for processing
    text = text.replace(`@${botUsername}`, '').trim();
  }

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    console.error('❌ OpenAI API key not configured');
    try {
      await sendTelegramMessage(
        botSettings.telegram.botToken,
        chatId,
        'Sorry, the AI service is not configured. Please contact the administrator.'
      );
    } catch (error) {
      console.error('❌ Error sending API key error message:', error);
    }
    return;
  }

  try {
    console.log(`🤖 Processing message with AI: "${text}"`);

    // Send typing indicator immediately to show bot is processing
    sendTypingIndicator(botSettings.telegram.botToken, chatId).catch(() => {
      // Ignore typing indicator errors
    });

    // Keep typing indicator active during processing - reduced interval for better UX
    const typingInterval = setInterval(() => {
      sendTypingIndicator(botSettings.telegram.botToken, chatId).catch(() => { });
    }, 2000); // Send typing indicator every 2 seconds (faster feedback)

    // Process message with AI - with better error handling
    let reply: string;
    try {
      reply = await processChatMessage(
        botSettings,
        text,
        apiKey,
        'telegram'
      );
      clearInterval(typingInterval);
      console.log(`✅ AI reply generated: "${reply.substring(0, 50)}..."`);

    } catch (aiError: any) {
      clearInterval(typingInterval);
      console.error('❌ AI processing error:', aiError);

      // Send user-friendly error message
      const errorMsg = aiError.message?.includes('timeout')
        ? 'Xin lỗi, yêu cầu của bạn mất quá nhiều thời gian để xử lý. Vui lòng thử lại sau.'
        : aiError.message?.includes('Rate limit')
          ? 'Xin lỗi, hệ thống đang quá tải. Vui lòng thử lại sau vài giây.'
          : 'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.';

      try {
        await sendTelegramMessage(
          botSettings.telegram.botToken,
          chatId,
          errorMsg
        );
      } catch {
        // Ignore if sending error message fails
      }
      return; // Exit early
    }

    // Format reply for Telegram HTML - convert markdown to HTML
    const { formatTelegramMessage } = await import('@/lib/utils/telegramFormatter');
    const formattedReply = formatTelegramMessage(reply);

    // Send reply with retry logic
    try {
      await sendTelegramMessage(
        botSettings.telegram.botToken,
        chatId,
        formattedReply
      );
      console.log('✅ Reply sent to Telegram');
    } catch (sendError: any) {
      console.error('❌ Error sending reply to Telegram:', sendError);
      // Try to send a fallback message
      try {
        await sendTelegramMessage(
          botSettings.telegram.botToken,
          chatId,
          'Xin lỗi, tôi đang gặp sự cố khi gửi phản hồi. Vui lòng thử lại sau.'
        ).catch(() => {
          // Ignore if this also fails
        });
      } catch {
        // Ignore
      }
      throw sendError; // Re-throw to be caught by outer catch
    }

    // Track message - do this asynchronously to not block response
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
        console.error('⚠️ Error tracking Telegram message:', trackingError);
      }
    });
  } catch (error: any) {
    console.error('❌ Error handling Telegram message:', error);
    console.error('Error details:', error instanceof Error ? error.stack : error);

    // Only try to send error message if we have bot settings and it's not a network error
    if (botSettings?.telegram?.botToken) {
      const isNetworkError = error.code === 'ETIMEDOUT' ||
        error.code === 'ECONNRESET' ||
        error.code === 'ENOTFOUND' ||
        error.message?.includes('timeout') ||
        error.message?.includes('ETIMEDOUT');

      if (!isNetworkError) {
        try {
          // Use a shorter timeout for error messages
          await Promise.race([
            sendTelegramMessage(
              botSettings.telegram.botToken,
              chatId,
              'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.'
            ),
            new Promise<never>((_, reject) =>
              setTimeout(() => reject(new Error('Timeout')), 5000)
            )
          ]).catch(() => {
            // Ignore if sending error message also fails
          });
        } catch (sendError) {
          console.error('❌ Error sending error message to user:', sendError);
        }
      } else {
        console.error('⚠️ Network error detected, skipping error message to avoid further timeouts');
      }
    }
  }
}

