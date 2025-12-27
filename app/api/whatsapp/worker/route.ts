import { NextRequest, NextResponse } from 'next/server';
import { handleWhatsAppMessage } from '@/lib/services/whatsappService';

/**
 * Worker endpoint to process queued WhatsApp messages
 * This endpoint is called by QStash queue system
 */

// Force dynamic rendering - worker should never be pre-rendered
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    
    const { webhookData, botId, timestamp } = body;

    if (!webhookData) {
      console.error('❌ Invalid queue message: missing webhookData');
      return NextResponse.json(
        { error: 'Invalid message format' },
        { status: 400 }
      );
    }

    console.log('🔄 Processing queued WhatsApp message:', {
      botId: botId || 'not provided',
      object: webhookData.object,
      entryCount: webhookData.entry?.length || 0,
      queuedAt: timestamp ? new Date(timestamp).toISOString() : 'unknown',
      processingDelay: timestamp ? Date.now() - timestamp : 'unknown',
    });

    // Process the message
    await handleWhatsAppMessage(webhookData, botId);

    return NextResponse.json({ 
      success: true,
      processedAt: Date.now(),
    });
  } catch (error) {
    console.error('❌ Error processing queued WhatsApp message:', error);
    console.error('Error details:', error instanceof Error ? error.stack : error);
    
    // Return 500 so QStash will retry
    return NextResponse.json(
      { 
        error: 'Processing failed',
        message: error instanceof Error ? error.message : String(error)
      },
      { status: 500 }
    );
  }
}

