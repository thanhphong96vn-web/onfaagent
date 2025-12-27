import { NextRequest, NextResponse } from 'next/server';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/whatsapp-web/status?botId=xxx
 * Get WhatsApp Web client status from MongoDB
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const botId = searchParams.get('botId');

    if (!botId) {
      return NextResponse.json(
        { error: 'botId is required' },
        { status: 400 }
      );
    }

    await connectDB();
    
    // Đọc status từ MongoDB
    const botSettings = await BotSettings.findOne({ botId })
      .select('whatsapp.enabled whatsapp.phoneNumber whatsapp.verifiedName whatsapp.qrCode')
      .lean() as any;

    if (!botSettings) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Nếu có phoneNumber và không có QR code → đã authenticated
    const authenticated = !!(botSettings.whatsapp?.phoneNumber && !botSettings.whatsapp?.qrCode);

    return NextResponse.json({
      botId,
      authenticated,
      phoneNumber: botSettings.whatsapp?.phoneNumber || undefined,
      name: botSettings.whatsapp?.verifiedName || botSettings.whatsapp?.phoneNumber || undefined
    });
  } catch (error: any) {
    console.error('❌ Error getting status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    );
  }
}

