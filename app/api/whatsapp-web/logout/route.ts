import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * POST /api/whatsapp-web/logout
 * Logout WhatsApp Web client
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { botId } = body;

    if (!botId) {
      return NextResponse.json(
        { error: 'botId is required' },
        { status: 400 }
      );
    }

    // Dynamic import to avoid bundling whatsapp-web.js in Next.js build
    const { logoutWhatsAppWebClient } = await import('@/lib/services/whatsappWebService');
    const success = await logoutWhatsAppWebClient(botId);

    if (success) {
      return NextResponse.json({
        success: true,
        message: 'WhatsApp Web client logged out successfully'
      });
    } else {
      return NextResponse.json(
        { error: 'Client not found or already logged out' },
        { status: 404 }
      );
    }
  } catch (error: any) {
    console.error('❌ Error logging out:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to logout' },
      { status: 500 }
    );
  }
}

