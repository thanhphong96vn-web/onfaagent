import { NextRequest, NextResponse } from 'next/server';
import { handleWhatsAppMessage, verifyWhatsAppWebhook } from '@/lib/services/whatsappService';
import { queueWhatsAppMessage } from '@/lib/services/queueService';

// Force dynamic rendering - webhook should never be pre-rendered
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

// Handle GET request for webhook verification
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const mode = searchParams.get('hub.mode');
    const token = searchParams.get('hub.verify_token');
    const challenge = searchParams.get('hub.challenge');
    const botId = searchParams.get('botId');

    console.log('📨 WhatsApp webhook verification:', {
      mode,
      token: token ? 'provided' : 'not provided',
      challenge: challenge ? 'provided' : 'not provided',
      botId: botId || 'not provided'
    });

    // Get verify token from bot settings if botId provided
    let verifyToken = '';
    if (botId) {
      const { default: connectDB } = await import('@/lib/db');
      const { default: BotSettings } = await import('@/lib/models/BotSettings');
      
      await connectDB();
      const botSettings = await BotSettings.findOne({ botId: botId.trim() }).lean() as any;
      
      if (botSettings?.whatsapp?.verifyToken) {
        verifyToken = botSettings.whatsapp.verifyToken;
      }
    }

    // If no verify token in bot settings, use default from env
    if (!verifyToken) {
      verifyToken = process.env.WHATSAPP_VERIFY_TOKEN || 'default_verify_token';
    }

    if (verifyWhatsAppWebhook(mode, token, verifyToken)) {
      console.log('✅ WhatsApp webhook verified');
      return new NextResponse(challenge || '', { status: 200 });
    } else {
      console.error('❌ WhatsApp webhook verification failed');
      return NextResponse.json({ error: 'Verification failed' }, { status: 403 });
    }
  } catch (error) {
    console.error('❌ WhatsApp webhook verification error:', error);
    return NextResponse.json({ error: 'Verification error' }, { status: 500 });
  }
}

// Handle POST request for incoming messages
export async function POST(request: NextRequest) {
  try {
    const webhookData = await request.json();
    
    // Get botId from query parameter if available
    const { searchParams } = new URL(request.url);
    let botId = searchParams.get('botId');
    
    // Decode botId properly (handle URL encoding)
    if (botId) {
      botId = decodeURIComponent(botId).trim();
    }
    
    console.log('📨 WhatsApp webhook received:', {
      botId: botId || 'not provided',
      object: webhookData.object,
      entryCount: webhookData.entry?.length || 0,
    });
    
    // Try to queue the message for async processing (faster response)
    const queued = await queueWhatsAppMessage(webhookData, botId || undefined);
    
    if (queued) {
      console.log('✅ Message queued for async processing');
      return NextResponse.json({ 
        ok: true, 
        queued: true,
        message: 'Message queued for processing'
      });
    } else {
      // Fallback: process synchronously if queue not available
      console.log('⚠️ Queue not available, processing synchronously (fallback mode)');
      
      handleWhatsAppMessage(webhookData, botId || undefined).catch(error => {
        console.error('❌ Error processing WhatsApp webhook:', error);
        console.error('Error stack:', error instanceof Error ? error.stack : error);
      });
      
      return NextResponse.json({ 
        ok: true, 
        queued: false,
        message: 'Processing synchronously (queue not configured or failed)'
      });
    }
  } catch (error) {
    console.error('❌ WhatsApp webhook error:', error);
    console.error('Error details:', error instanceof Error ? error.message : String(error));
    // Still return 200 to prevent WhatsApp from retrying
    return NextResponse.json({ ok: true });
  }
}

