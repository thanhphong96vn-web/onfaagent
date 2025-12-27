import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import { getWhatsAppPhoneNumberInfo } from '@/lib/services/whatsappService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { accessToken, phoneNumberId } = await request.json();

    if (!accessToken || !phoneNumberId) {
      return NextResponse.json(
        { error: 'accessToken and phoneNumberId are required' },
        { status: 400 }
      );
    }

    try {
      const phoneInfo = await getWhatsAppPhoneNumberInfo(accessToken, phoneNumberId);
      return NextResponse.json({
        success: true,
        phoneInfo
      });
    } catch (error: any) {
      console.error('Error getting WhatsApp phone number info:', error);
      return NextResponse.json(
        { 
          error: 'Failed to get phone number info',
          details: error.message 
        },
        { status: 400 }
      );
    }
  } catch (error: any) {
    console.error('Error in phone-info endpoint:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

