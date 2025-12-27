import { NextRequest, NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * GET /api/whatsapp-web/qr-code?botId=xxx
 * Get QR code for WhatsApp Web authentication
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
    const { getQRCode, initializeWhatsAppWebClient, getClientStatus } = await import('@/lib/services/whatsappWebService');
    
    // Try to get existing QR code
    let qrCode = getQRCode(botId);

    // If no QR code, initialize client (this will generate QR code)
    if (!qrCode) {
      const result = await initializeWhatsAppWebClient(botId);
      if (result.success && result.qrCode) {
        qrCode = result.qrCode;
      } else if (result.error) {
        return NextResponse.json(
          { error: result.error },
          { status: 500 }
        );
      }
    }

    if (!qrCode) {
      // Check if client is already authenticated
      const status = await getClientStatus(botId);
      if (status.authenticated) {
        return NextResponse.json({
          authenticated: true,
          phoneNumber: status.phoneNumber,
          name: status.name,
          message: 'WhatsApp Web is already authenticated'
        });
      }

      return NextResponse.json(
        { error: 'QR code not available yet. Please wait a moment and try again.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      qrCode,
      botId,
      message: 'Scan this QR code with WhatsApp to authenticate'
    });
  } catch (error: any) {
    console.error('❌ Error getting QR code:', error);
    return NextResponse.json(
      { error: error.message || 'Failed to get QR code' },
      { status: 500 }
    );
  }
}

