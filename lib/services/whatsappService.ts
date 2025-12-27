import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import Message from '@/lib/models/Message';
import { processChatMessage } from './chatService';

// Cache for bot settings to reduce database queries
const botSettingsCache = new Map<string, { settings: any; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes cache

/**
 * Invalidate bot settings cache (call this when bot settings are updated)
 */
export function invalidateWhatsAppBotSettingsCache(botId?: string): void {
  if (botId) {
    const cacheKey = `whatsapp_${botId.trim()}`;
    botSettingsCache.delete(cacheKey);
    console.log(`🗑️ Invalidated WhatsApp cache for bot: ${botId}`);
  } else {
    // Clear all cache
    botSettingsCache.clear();
    console.log('🗑️ Cleared all WhatsApp bot settings cache');
  }
}

/**
 * Send message via WhatsApp Business API
 */
export async function sendWhatsAppMessage(
  accessToken: string,
  phoneNumberId: string,
  to: string,
  message: string
): Promise<any> {
  const maxRetries = 3;
  let lastError: any = null;

  const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/messages`;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      console.log(`📤 Sending WhatsApp message (attempt ${attempt}/${maxRetries})...`);
      
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: to,
          type: 'text',
          text: {
            body: message
          }
        }),
      });

      const result = await response.json();

      if (!response.ok) {
        throw new Error(result.error?.message || `HTTP ${response.status}`);
      }

      console.log(`✅ WhatsApp message sent successfully`);
      return result;
    } catch (error: any) {
      lastError = error;
      const errorCode = error.status || error.response?.status;

      console.error(`❌ WhatsApp send error (attempt ${attempt}/${maxRetries}):`, {
        code: errorCode,
        message: error.message || String(error),
        to,
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
  console.error(`❌ Failed to send WhatsApp message after ${maxRetries} attempts`);
  throw lastError || new Error('Failed to send WhatsApp message');
}

/**
 * Handle incoming WhatsApp message
 */
export async function handleWhatsAppMessage(webhookData: any, botId?: string) {
  // WhatsApp webhook structure: { object: 'whatsapp_business_account', entry: [...] }
  if (webhookData.object !== 'whatsapp_business_account') {
    console.log('⚠️ WhatsApp webhook has wrong object type, skipping');
    return;
  }

  // Process each entry
  for (const entry of webhookData.entry || []) {
    const changes = entry.changes || [];
    
    for (const change of changes) {
      if (change.field !== 'messages') {
        continue;
      }

      const value = change.value;
      const messages = value.messages || [];
      const contacts = value.contacts || [];
      const metadata = value.metadata || {};

      // Process each message
      for (const message of messages) {
        // Only process text messages for now
        if (message.type !== 'text') {
          console.log(`⚠️ WhatsApp message type ${message.type} not supported, skipping`);
          continue;
        }

        const from = message.from; // Phone number
        const messageId = message.id;
        const text = message.text?.body || '';
        const timestamp = message.timestamp;

        // Get contact info
        const contact = contacts.find((c: any) => c.wa_id === from);
        const contactName = contact?.profile?.name || from;

        console.log(`🤖 Processing WhatsApp message: from=${from}, text="${text}", botId=${botId || 'not provided'}`);

        // Connect to DB
        await connectDB();

        let botSettings: any = null;

        if (botId) {
          const normalizedBotId = botId.trim();
          console.log(`🔍 Looking for bot with botId: "${normalizedBotId}"`);
          
          // Check cache first
          const cacheKey = `whatsapp_${normalizedBotId}`;
          const cached = botSettingsCache.get(cacheKey);
          if (cached && Date.now() - cached.timestamp < BOT_SETTINGS_CACHE_TTL) {
            console.log(`✅ Using cached bot settings for: ${normalizedBotId}`);
            botSettings = cached.settings;
          } else {
            botSettings = await BotSettings.findOne({ 
              botId: normalizedBotId,
              'whatsapp.enabled': true,
              'whatsapp.accessToken': { $exists: true }
            }).select('botId name userId whatsapp welcomeMessage faqs documents urls structuredData updatedAt').lean() as any;
            
            if (botSettings) {
              botSettingsCache.set(cacheKey, { settings: botSettings, timestamp: Date.now() });
            }
          }
        } else {
          // Fallback: find first enabled bot
          console.log('🔍 No botId provided, searching for enabled bots...');
          const bots = await BotSettings.find({ 
            'whatsapp.enabled': true,
            'whatsapp.accessToken': { $exists: true }
          }).select('botId name userId whatsapp welcomeMessage faqs documents urls structuredData updatedAt').lean() as any[];
          
          if (bots.length > 0) {
            botSettings = bots[0];
            console.log(`✅ Using first enabled bot: ${botSettings.name} (${botSettings.botId})`);
          }
        }

        if (!botSettings || !botSettings.whatsapp?.accessToken || !botSettings.whatsapp?.phoneNumberId) {
          console.error('❌ WhatsApp bot not found or not configured');
          return;
        }

        // Handle welcome message (if message is "hi", "hello", "start", etc.)
        const lowerText = text.toLowerCase().trim();
        if (lowerText === '/start' || lowerText === 'start' || lowerText === 'hi' || lowerText === 'hello' || lowerText === 'xin chào') {
          console.log(`📝 Handling welcome message for from: ${from}`);
          try {
            await sendWhatsAppMessage(
              botSettings.whatsapp.accessToken,
              botSettings.whatsapp.phoneNumberId,
              from,
              botSettings.welcomeMessage || `Xin chào! Tôi là ${botSettings.name}. Tôi có thể giúp gì cho bạn?`
            );
            console.log('✅ Welcome message sent');
          } catch (error: any) {
            console.error('❌ Error sending welcome message:', error);
          }
          return;
        }

        // Ignore empty messages
        if (!text.trim()) {
          console.log('⚠️ Empty message, skipping');
          return;
        }

        const apiKey = process.env.OPENAI_API_KEY || '';
        if (!apiKey) {
          console.error('❌ OpenAI API key not configured');
          try {
            await sendWhatsAppMessage(
              botSettings.whatsapp.accessToken,
              botSettings.whatsapp.phoneNumberId,
              from,
              'Sorry, the AI service is not configured. Please contact the administrator.'
            );
          } catch (error) {
            console.error('❌ Error sending API key error message:', error);
          }
          return;
        }

        try {
          console.log(`🤖 Processing message with AI: "${text}"`);
          
          // Process message with AI
          const reply = await processChatMessage(
            botSettings,
            text,
            apiKey,
            'whatsapp'
          );

          console.log(`✅ AI reply generated: "${reply.substring(0, 50)}..."`);

          // Send reply
          await sendWhatsAppMessage(
            botSettings.whatsapp.accessToken,
            botSettings.whatsapp.phoneNumberId,
            from,
            reply
          );
          console.log('✅ Reply sent to WhatsApp');

          // Track message asynchronously
          setImmediate(async () => {
            try {
              const messageRecord = new Message({
                userId: botSettings.userId,
                botId: botSettings.botId,
                message: text,
                response: reply,
                timestamp: new Date(),
                sessionId: `whatsapp_${from}`
              });
              await messageRecord.save();
              console.log('✅ Message tracked in database');
            } catch (trackingError) {
              console.error('⚠️ Error tracking WhatsApp message:', trackingError);
            }
          });
        } catch (error: any) {
          console.error('❌ Error handling WhatsApp message:', error);
          console.error('Error details:', error instanceof Error ? error.stack : error);
          
          const errorMsg = error.message?.includes('timeout')
            ? 'Xin lỗi, yêu cầu của bạn mất quá nhiều thời gian để xử lý. Vui lòng thử lại sau.'
            : error.message?.includes('Rate limit')
            ? 'Xin lỗi, hệ thống đang quá tải. Vui lòng thử lại sau vài giây.'
            : 'Xin lỗi, tôi đang gặp sự cố khi xử lý tin nhắn của bạn. Vui lòng thử lại sau.';
          
          try {
            await sendWhatsAppMessage(
              botSettings.whatsapp.accessToken,
              botSettings.whatsapp.phoneNumberId,
              from,
              errorMsg
            );
          } catch {
            // Ignore if sending error message fails
          }
        }
      }
    }
  }
}

/**
 * Verify WhatsApp webhook
 */
export function verifyWhatsAppWebhook(mode: string | null, token: string | null, verifyToken: string): boolean {
  return mode === 'subscribe' && token === verifyToken;
}

/**
 * Set WhatsApp webhook
 */
export async function setWhatsAppWebhook(
  accessToken: string,
  phoneNumberId: string,
  webhookUrl: string,
  verifyToken: string
): Promise<{ success: boolean; error?: string; details?: any }> {
  try {
    // Note: WhatsApp webhook is typically configured in Meta Business Suite
    // This function can be used to verify webhook configuration
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}/subscribed_apps`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        subscribed_fields: ['messages']
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      return {
        success: false,
        error: result.error?.message || 'Failed to configure webhook',
        details: result
      };
    }

    return { success: true, details: result };
  } catch (error: any) {
    console.error('Error setting WhatsApp webhook:', error);
    return {
      success: false,
      error: error.message || 'Failed to set webhook',
      details: error
    };
  }
}

/**
 * Get WhatsApp phone number info
 */
export async function getWhatsAppPhoneNumberInfo(accessToken: string, phoneNumberId: string) {
  try {
    const url = `https://graph.facebook.com/v18.0/${phoneNumberId}?fields=display_phone_number,verified_name`;
    
    const response = await fetch(url, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    const result = await response.json();

    if (!response.ok) {
      throw new Error(result.error?.message || 'Failed to get phone number info');
    }

    return {
      phoneNumber: result.display_phone_number || '',
      verifiedName: result.verified_name || '',
    };
  } catch (error) {
    console.error('Error getting WhatsApp phone number info:', error);
    throw error;
  }
}

