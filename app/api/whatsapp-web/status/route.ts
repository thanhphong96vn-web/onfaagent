import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/whatsapp-web/status?botId=xxx
 * Get WhatsApp Web client status
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

    // Dynamic import to avoid bundling whatsapp-web.js in Next.js build
    const { getClientStatus } = await import('@/lib/services/whatsappWebService');
    const status = await getClientStatus(botId);

    return NextResponse.json({
      botId,
      ...status
    });
  } catch (error: any) {
    console.error('❌ Error getting status:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get status' },
      { status: 500 }
    );
  }
}

