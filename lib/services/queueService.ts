import { Client } from '@upstash/qstash';

// Initialize QStash client
let qstashClient: Client | null = null;

function getQStashClient(): Client | null {
  const token = process.env.QSTASH_TOKEN;
  
  if (!token) {
    console.warn('⚠️ QSTASH_TOKEN not configured, queue will be disabled');
    return null;
  }

  if (!qstashClient) {
    qstashClient = new Client({ token });
  }

  return qstashClient;
}

export interface TelegramQueueMessage {
  update: any; // TelegramBot.Update
  botId?: string;
  timestamp: number;
}

export interface WhatsAppQueueMessage {
  webhookData: any; // WhatsApp webhook data
  botId?: string;
  timestamp: number;
}

/**
 * Add Telegram message to queue for async processing
 */
export async function queueTelegramMessage(
  update: any,
  botId?: string
): Promise<boolean> {
  const client = getQStashClient();
  
  if (!client) {
    // Fallback: if queue not configured, return false to process synchronously
    return false;
  }

  try {
    const queueMessage: TelegramQueueMessage = {
      update,
      botId,
      timestamp: Date.now(),
    };

    // Get the worker endpoint URL
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || process.env.WEBHOOK_URL || 'http://localhost:3000';
    
    const workerUrl = `${baseUrl}/api/telegram/worker`;

    // Send message to queue
    await client.publishJSON({
      url: workerUrl,
      body: queueMessage,
      // Retry configuration
      retries: 3,
      // Timeout for processing (60 seconds)
      timeout: 60,
    });

    console.log('✅ Telegram message queued successfully');
    return true;
  } catch (error) {
    console.error('❌ Error queueing Telegram message:', error);
    return false;
  }
}

/**
 * Add WhatsApp message to queue for async processing
 */
export async function queueWhatsAppMessage(
  webhookData: any,
  botId?: string
): Promise<boolean> {
  const client = getQStashClient();
  
  if (!client) {
    // Fallback: if queue not configured, return false to process synchronously
    return false;
  }

  try {
    const queueMessage: WhatsAppQueueMessage = {
      webhookData,
      botId,
      timestamp: Date.now(),
    };

    // Get the worker endpoint URL
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || process.env.WEBHOOK_URL || 'http://localhost:3000';
    
    const workerUrl = `${baseUrl}/api/whatsapp/worker`;

    // Send message to queue
    await client.publishJSON({
      url: workerUrl,
      body: queueMessage,
      // Retry configuration
      retries: 3,
      // Timeout for processing (60 seconds)
      timeout: 60,
    });

    console.log('✅ WhatsApp message queued successfully');
    return true;
  } catch (error) {
    console.error('❌ Error queueing WhatsApp message:', error);
    return false;
  }
}

/**
 * Check if queue is available
 */
export function isQueueAvailable(): boolean {
  return !!process.env.QSTASH_TOKEN && !!getQStashClient();
}

