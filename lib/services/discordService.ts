'use server';

import { Client, GatewayIntentBits, Message as DiscordMessage, TextChannel, DMChannel, ThreadChannel } from 'discord.js';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import Message from '@/lib/models/Message';
import { processChatMessage } from './chatService';

// Store active Discord bot instances
const botInstances = new Map<string, Client>();

// Cache for bot settings to reduce database queries
const botSettingsCache = new Map<string, { settings: any; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

/**
 * Initialize or get Discord bot instance
 */
export function getDiscordBot(token: string): Client {
  if (botInstances.has(token)) {
    return botInstances.get(token)!;
  }

  const client = new Client({
    intents: [
      GatewayIntentBits.Guilds,
      GatewayIntentBits.GuildMessages,
      GatewayIntentBits.MessageContent,
      GatewayIntentBits.DirectMessages,
    ],
  });

  botInstances.set(token, client);
  return client;
}

/**
 * Send message to Discord channel or DM
 */
export async function sendDiscordMessage(
  client: Client,
  channelId: string,
  message: string
): Promise<DiscordMessage> {
  try {
    const channel = await client.channels.fetch(channelId);
    
    if (!channel) {
      throw new Error(`Channel ${channelId} not found`);
    }

    if (!channel.isTextBased()) {
      throw new Error(`Channel ${channelId} is not a text channel`);
    }

    const sentMessage = await channel.send(message);
    console.log(`✅ Discord message sent to channel: ${channelId}`);
    return sentMessage;
  } catch (error: any) {
    console.error(`❌ Error sending Discord message:`, error);
    throw error;
  }
}

/**
 * Handle incoming Discord message
 */
export async function handleDiscordMessage(
  message: DiscordMessage,
  botId?: string
) {
  // Ignore bot messages
  if (message.author.bot) {
    return;
  }

  // Only handle DMs or mentions in channels
  const isDM = message.channel.type === 1; // DMChannel
  const isMentioned = message.mentions.has(message.client.user!);
  const isReply = message.reference !== null;

  if (!isDM && !isMentioned && !isReply) {
    return;
  }

  const text = message.content.replace(/<@!?\d+>/g, '').trim();
  const channelId = message.channel.id;
  const userId = message.author.id;

  console.log(`🤖 Processing Discord message: channelId=${channelId}, userId=${userId}, text="${text}", botId=${botId || 'not provided'}`);

  // Connect to DB
  await connectDB();

  let botSettings: any = null;

  if (botId) {
    const normalizedBotId = botId.trim();
    console.log(`🔍 Looking for bot with botId: "${normalizedBotId}"`);
    
    // Check cache first
    const cacheKey = `discord_${normalizedBotId}`;
    const cached = botSettingsCache.get(cacheKey);
    if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
      console.log(`✅ Using cached bot settings for: ${normalizedBotId}`);
      botSettings = cached.settings;
    } else {
      botSettings = await BotSettings.findOne({ 
        botId: normalizedBotId,
        'discord.enabled': true,
        'discord.botToken': { $exists: true }
      }).select('botId name userId discord welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;
      
      if (botSettings) {
        botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
      }
    }
  } else {
    // Find first enabled Discord bot
    botSettings = await BotSettings.findOne({
      'discord.enabled': true,
      'discord.botToken': { $exists: true }
    }).select('botId name userId discord welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;
  }

  if (!botSettings) {
    console.error(`❌ Discord bot settings not found for bot: ${botId || 'any'}`);
    return;
  }

  // Handle welcome message
  const lowerText = text.toLowerCase().trim();
  if (lowerText === '/start' || lowerText === 'start' || lowerText === 'hi' || lowerText === 'hello' || lowerText === 'xin chào') {
    try {
      await sendDiscordMessage(
        message.client,
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

  // Get OpenAI API key
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error('❌ OpenAI API key not configured');
    try {
      await sendDiscordMessage(
        message.client,
        channelId,
        'Sorry, the AI service is not configured. Please contact the administrator.'
      );
    } catch (error) {
      console.error('❌ Error sending API key error message:', error);
    }
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
      apiKey,
      'discord'
    );

    console.log(`✅ AI reply generated: "${reply.substring(0, 100)}..."`);

    // Send reply
    await sendDiscordMessage(message.client, channelId, reply);
    console.log('✅ Reply sent to Discord');

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
        console.error('⚠️ Error tracking Discord message:', trackingError);
      }
    });
  } catch (error: any) {
    console.error('❌ Error processing Discord message:', error);

    const errorMsg = error.message?.includes('timeout')
      ? 'Xin lỗi, yêu cầu của bạn mất quá nhiều thời gian để xử lý. Vui lòng thử lại sau.'
      : error.message?.includes('Rate limit')
      ? 'Xin lỗi, hệ thống đang quá tải. Vui lòng thử lại sau vài giây.'
      : 'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.';

    try {
      await sendDiscordMessage(message.client, channelId, errorMsg);
    } catch {
      // Ignore if sending error message fails
    }
  }
}

/**
 * Invalidate bot settings cache (call this when bot settings are updated)
 */
export function invalidateDiscordBotSettingsCache(botId?: string): void {
  if (botId) {
    const cacheKey = `discord_${botId.trim()}`;
    botSettingsCache.delete(cacheKey);
    console.log(`🗑️ Invalidated Discord cache for bot: ${botId}`);
  } else {
    // Clear all cache
    botSettingsCache.clear();
    console.log('🗑️ Cleared all Discord bot settings cache');
  }
}

