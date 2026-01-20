import { Client, LocalAuth, Message as WhatsAppMessage } from 'whatsapp-web.js';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import Message from '@/lib/models/Message';
import { processChatMessage } from './chatService';
import * as qrcode from 'qrcode';

// Store active WhatsApp Web client instances
const clientInstances = new Map<string, Client>();

// Store QR codes for each bot
const qrCodeStore = new Map<string, { qr: string; timestamp: number }>();
const QR_CODE_TTL = 5 * 60 * 1000; // 5 minutes

// Cache for bot settings
const botSettingsCache = new Map<string, { settings: any; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Get or create WhatsApp Web client for a bot
 */
export function getWhatsAppWebClient(botId: string): Client | null {
  if (clientInstances.has(botId)) {
    return clientInstances.get(botId)!;
  }
  return null;
}

/**
 * Initialize WhatsApp Web client for a bot
 */
export async function initializeWhatsAppWebClient(botId: string): Promise<{
  success: boolean;
  error?: string;
  qrCode?: string;
  client?: Client;
}> {
  try {
    await connectDB();

    const botSettings = await BotSettings.findOne({ botId }).lean() as any;
    if (!botSettings) {
      return { success: false, error: 'Bot not found' };
    }

    // Check if client already exists
    if (clientInstances.has(botId)) {
      const existingClient = clientInstances.get(botId)!;
      if (existingClient.info) {
        return {
          success: true,
          client: existingClient
        };
      }
    }

    // Create new client with LocalAuth (saves session locally)
    const client = new Client({
      authStrategy: new LocalAuth({
        clientId: `whatsapp_${botId}`,
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
          '--disable-gpu'
        ]
      }
    });

    // Store QR code when generated
    client.on('qr', async (qr: string) => {
      console.log(`📱 QR Code generated for bot: ${botId}`);
      try {
        // Convert QR string to data URL
        const qrDataUrl = await qrcode.toDataURL(qr);
        qrCodeStore.set(botId, {
          qr: qrDataUrl,
          timestamp: Date.now()
        });
        console.log(`✅ QR Code stored for bot: ${botId}`);
      } catch (error) {
        console.error('❌ Error generating QR code image:', error);
        // Store raw QR string as fallback
        qrCodeStore.set(botId, {
          qr: qr,
          timestamp: Date.now()
        });
      }
    });

    // Handle authentication success
    client.on('ready', () => {
      console.log(`✅ WhatsApp Web client ready for bot: ${botId}`);
      qrCodeStore.delete(botId); // Clear QR code
    });

    // Handle authentication failure
    client.on('auth_failure', (msg) => {
      console.error(`❌ WhatsApp Web auth failure for bot ${botId}:`, msg);
      clientInstances.delete(botId);
      qrCodeStore.delete(botId);
    });

    // Handle disconnection
    client.on('disconnected', (reason) => {
      console.log(`⚠️ WhatsApp Web disconnected for bot ${botId}:`, reason);
      clientInstances.delete(botId);
      qrCodeStore.delete(botId);
    });

    // Handle incoming messages
    client.on('message', async (msg: any) => {
      try {
        await handleWhatsAppWebMessage(botId, msg);
      } catch (error) {
        console.error(`❌ Error handling WhatsApp Web message for bot ${botId}:`, error);
      }
    });

    // Initialize client
    await client.initialize();
    
    clientInstances.set(botId, client);

    // Check if QR code is available
    const qrData = qrCodeStore.get(botId);
    if (qrData) {
      return {
        success: true,
        qrCode: qrData.qr,
        client
      };
    }

    // If client is already authenticated, return success
    if (client.info) {
      return {
        success: true,
        client
      };
    }

    return {
      success: true,
      client
    };
  } catch (error: any) {
    console.error(`❌ Error initializing WhatsApp Web client for bot ${botId}:`, error);
    return {
      success: false,
      error: error.message || 'Failed to initialize client'
    };
  }
}

/**
 * Get QR code for a bot
 */
export function getQRCode(botId: string): string | null {
  const qrData = qrCodeStore.get(botId);
  if (!qrData) {
    return null;
  }

  // Check if QR code is expired
  if (Date.now() - qrData.timestamp > QR_CODE_TTL) {
    qrCodeStore.delete(botId);
    return null;
  }

  return qrData.qr;
}

/**
 * Get client status
 */
export async function getClientStatus(botId: string): Promise<{
  authenticated: boolean;
  phoneNumber?: string;
  name?: string;
}> {
  const client = clientInstances.get(botId);
  if (!client) {
    return { authenticated: false };
  }

  if (!client.info) {
    return { authenticated: false };
  }

  return {
    authenticated: true,
    phoneNumber: client.info.wid.user,
    name: client.info.pushname || client.info.wid.user
  };
}

/**
 * Logout and destroy client
 */
export async function logoutWhatsAppWebClient(botId: string): Promise<boolean> {
  try {
    const client = clientInstances.get(botId);
    if (client) {
      await client.logout();
      await client.destroy();
      clientInstances.delete(botId);
      qrCodeStore.delete(botId);
      console.log(`✅ WhatsApp Web client logged out for bot: ${botId}`);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`❌ Error logging out WhatsApp Web client for bot ${botId}:`, error);
    return false;
  }
}

/**
 * Send message via WhatsApp Web
 * Handles sendSeen errors gracefully by retrying
 */
export async function sendWhatsAppWebMessage(
  botId: string,
  to: string,
  message: string
): Promise<boolean> {
  const client = clientInstances.get(botId);
  if (!client) {
    throw new Error('WhatsApp Web client not initialized');
  }

  if (!client.info) {
    throw new Error('WhatsApp Web client not authenticated');
  }

  // Handle both @c.us and @lid formats
  let chatId: string;
  const isLidChat = to.includes('@lid');
  
  if (to.includes('@')) {
    // Already has format like 84922156755@c.us or 206206329217189@lid
    chatId = to;
  } else {
    // Just phone number, add @c.us
    const phoneNumber = to.replace(/[^0-9]/g, '');
    chatId = `${phoneNumber}@c.us`;
  }

  const maxRetries = isLidChat ? 3 : 2; // More retries for @lid chats
  let lastError: any = null;
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      // For @lid chats, skip getChatById check as it may not work reliably
      // For @c.us chats, try to ensure chat is loaded
      if (!isLidChat) {
        try {
          await client.getChatById(chatId);
        } catch (chatError) {
          // Chat might not exist yet - this is okay, we'll try to send anyway
          if (attempt === 1) {
            console.log(`⚠️ Chat ${chatId} not found, will attempt to send anyway...`);
          }
        }
      }
      
      await client.sendMessage(chatId, message);
      console.log(`✅ WhatsApp Web message sent to ${chatId}`);
      return true;
    } catch (error: any) {
      lastError = error;
      
      // Check if it's the markedUnread/sendSeen error
      const isSendSeenError = error.message?.includes('markedUnread') || 
                             error.message?.includes('Cannot read properties of undefined') ||
                             error.message?.includes('sendSeen') ||
                             (error.stack && error.stack.includes('sendSeen'));
      
      if (isSendSeenError && attempt < maxRetries) {
        console.warn(`⚠️ sendSeen error for ${chatId} (attempt ${attempt}/${maxRetries}), retrying...`);
        // Wait longer for @lid chats, shorter for @c.us chats
        const waitTime = isLidChat ? 2000 * attempt : 1000 * attempt;
        await new Promise(resolve => setTimeout(resolve, waitTime));
        continue; // Retry
      } else if (isSendSeenError) {
        // Last attempt failed with sendSeen error
        // For @lid chats, this is often a false error - message was likely sent
        // Try to verify by checking if we can get the chat (optional verification)
        if (isLidChat) {
          try {
            // Small delay to let WhatsApp process
            await new Promise(resolve => setTimeout(resolve, 500));
            const chat = await client.getChatById(chatId).catch(() => null);
            if (chat) {
              console.log(`✅ Message likely sent successfully to ${chatId} (verified chat exists)`);
            } else {
              console.warn(`⚠️ sendSeen error persisted for ${chatId} after ${maxRetries} attempts`);
              console.warn(`⚠️ Message may have been sent successfully despite the error`);
            }
          } catch (verifyError) {
            console.warn(`⚠️ sendSeen error persisted for ${chatId} after ${maxRetries} attempts`);
            console.warn(`⚠️ Message may have been sent successfully despite the error`);
          }
        } else {
          console.warn(`⚠️ sendSeen error persisted for ${chatId} after ${maxRetries} attempts`);
          console.warn(`⚠️ Message may have been sent successfully despite the error`);
        }
        // Return true - treat as success since message was likely sent
        return true;
      }
      
      // For other errors, throw immediately
      console.error(`❌ Error sending WhatsApp Web message to ${chatId}:`, error);
      throw error;
    }
  }
  
  // Should not reach here, but if we do, throw the last error
  throw lastError || new Error('Failed to send message after retries');
}

/**
 * Handle incoming WhatsApp Web message
 */
async function handleWhatsAppWebMessage(botId: string, msg: any) {
  // Ignore status messages and group messages
  // Group chat IDs end with @g.us, personal chats end with @c.us or @lid
  if (msg.from === 'status@broadcast' || msg.from.endsWith('@g.us')) {
    return;
  }

  // Keep original from format (@lid or @c.us) - don't replace it
  const from = msg.from;
  const text = msg.body || '';
  const messageId = (msg.id as any)?._serialized || msg.id?.toString() || '';

  console.log(`📨 WhatsApp Web message received: from=${from}, text="${text.substring(0, 50)}..."`);

  await connectDB();

  // Get bot settings
  let botSettings: any = null;
  const cacheKey = `whatsapp_web_${botId}`;
  const cached = botSettingsCache.get(cacheKey);
  
  if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
    botSettings = cached.settings;
    console.log(`[WHATSAPP] Using cached bot settings for: ${botId}`);
  } else {
    botSettings = await BotSettings.findOne({ 
      botId,
      'whatsapp.enabled': true 
    }).select('botId name userId whatsapp welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;
    if (botSettings) {
      botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
      console.log(`[WHATSAPP] Loaded bot settings from database for: ${botId}`);
    } else {
      console.error(`[WHATSAPP] Bot settings not found for bot: ${botId}`);
    }
  }
  
  // Debug: Log botSettings structure
  if (botSettings) {
    console.log(`[WHATSAPP] Bot settings check:`);
    console.log(`[WHATSAPP]   Bot ID: ${botSettings.botId}`);
    console.log(`[WHATSAPP]   FAQs count: ${botSettings.faqs?.length || 0}`);
    console.log(`[WHATSAPP]   Documents count: ${botSettings.documents?.filter((d: any) => d.enabled)?.length || 0}`);
    console.log(`[WHATSAPP]   URLs count: ${botSettings.urls?.filter((u: any) => u.enabled)?.length || 0}`);
    console.log(`[WHATSAPP]   Structured data count: ${botSettings.structuredData?.filter((s: any) => s.enabled)?.length || 0}`);
  }

  if (!botSettings) {
    console.error(`❌ Bot settings not found for bot: ${botId}`);
    return;
  }

  // Handle welcome message
  const lowerText = text.toLowerCase().trim();
  if (lowerText === '/start' || lowerText === 'start' || lowerText === 'hi' || lowerText === 'hello' || lowerText === 'xin chào' || lowerText === 'lô') {
    try {
      await sendWhatsAppWebMessage(
        botId,
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

  const apiKey = process.env.OPENAI_API_KEY || '';
  if (!apiKey) {
    console.error('❌ OpenAI API key not configured');
    try {
      await sendWhatsAppWebMessage(
        botId,
        from,
        'Sorry, the AI service is not configured. Please contact the administrator.'
      );
    } catch (error) {
      console.error('❌ Error sending API key error message:', error);
    }
    return;
  }

  try {
    console.log(`🤖 Processing WhatsApp Web message with AI: "${text}"`);
    
    // Process message with AI
    const reply = await processChatMessage(
      botSettings,
      text,
      apiKey,
      'whatsapp'
    );

    console.log(`[WHATSAPP] ✅ AI reply generated: "${reply.substring(0, 100)}..."`);

    // Send reply
    await sendWhatsAppWebMessage(botId, from, reply);
    console.log('✅ Reply sent via WhatsApp Web');

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
        console.error('⚠️ Error tracking WhatsApp Web message:', trackingError);
      }
    });
  } catch (error: any) {
    console.error('❌ Error handling WhatsApp Web message:', error);
    
    const errorMsg = error.message?.includes('timeout')
      ? 'Xin lỗi, yêu cầu của bạn mất quá nhiều thời gian để xử lý. Vui lòng thử lại sau.'
      : error.message?.includes('Rate limit')
      ? 'Xin lỗi, hệ thống đang quá tải. Vui lòng thử lại sau vài giây.'
      : 'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.';
    
    try {
      await sendWhatsAppWebMessage(botId, from, errorMsg);
    } catch {
      // Ignore if sending error message fails
    }
  }
}

/**
 * Invalidate bot settings cache
 */
export function invalidateWhatsAppWebBotSettingsCache(botId?: string): void {
  if (botId) {
    const cacheKey = `whatsapp_web_${botId}`;
    botSettingsCache.delete(cacheKey);
    console.log(`🗑️ Invalidated WhatsApp Web cache for bot: ${botId}`);
  } else {
    botSettingsCache.clear();
    console.log('🗑️ Cleared all WhatsApp Web bot settings cache');
  }
}

