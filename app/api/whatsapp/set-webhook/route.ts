import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import { setWhatsAppWebhook, getWhatsAppPhoneNumberInfo, invalidateWhatsAppBotSettingsCache } from '@/lib/services/whatsappService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, accessToken, phoneNumberId, verifyToken, webhookUrl } = await request.json();

    if (!botId || !accessToken || !phoneNumberId) {
      return NextResponse.json(
        { error: 'botId, accessToken, and phoneNumberId are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find bot settings
    const botSettings = await BotSettings.findOne({ botId }).lean() as any;
    if (!botSettings) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Verify access token and get phone number info
    let phoneInfo;
    try {
      phoneInfo = await getWhatsAppPhoneNumberInfo(accessToken, phoneNumberId);
      console.log('✅ WhatsApp phone number info:', phoneInfo);
    } catch (error: any) {
      console.error('❌ Error getting WhatsApp phone number info:', error);
      return NextResponse.json(
        { 
          error: 'Invalid access token or phone number ID',
          details: error.message 
        },
        { status: 400 }
      );
    }

    // Get base URL for webhook
    const baseUrl = process.env.VERCEL_URL 
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXTAUTH_URL || process.env.WEBHOOK_URL || 'http://localhost:3000';
    
    const finalWebhookUrl = webhookUrl || `${baseUrl}/api/whatsapp/webhook?botId=${encodeURIComponent(botId)}`;
    const finalVerifyToken = verifyToken || `whatsapp_verify_${botId}_${Date.now()}`;

    // Configure webhook subscription
    try {
      const webhookResult = await setWhatsAppWebhook(
        accessToken,
        phoneNumberId,
        finalWebhookUrl,
        finalVerifyToken
      );

      if (!webhookResult.success) {
        return NextResponse.json(
          { 
            error: 'Failed to configure webhook',
            details: webhookResult.error 
          },
          { status: 500 }
        );
      }
    } catch (error: any) {
      console.error('⚠️ Webhook configuration warning:', error);
      // Continue even if webhook setup fails - user can configure in Meta Business Suite
    }

    // Update bot settings in database
    console.log(`🔧 Updating WhatsApp settings...`);
    const updateResult = await BotSettings.updateOne(
      { botId: botSettings.botId },
      {
        $set: {
          'whatsapp.enabled': true,
          'whatsapp.accessToken': accessToken,
          'whatsapp.phoneNumberId': phoneNumberId,
          'whatsapp.verifyToken': finalVerifyToken,
          'whatsapp.webhookUrl': finalWebhookUrl,
          'whatsapp.webhookSetAt': new Date(),
          'whatsapp.phoneNumber': phoneInfo.phoneNumber,
          'whatsapp.verifiedName': phoneInfo.verifiedName,
        }
      }
    );
    
    console.log(`✅ MongoDB update result:`, {
      matchedCount: updateResult.matchedCount,
      modifiedCount: updateResult.modifiedCount,
      acknowledged: updateResult.acknowledged
    });
    
    if (updateResult.matchedCount === 0) {
      return NextResponse.json(
        { error: 'Bot not found for update' },
        { status: 404 }
      );
    }

    // Invalidate cache
    invalidateWhatsAppBotSettingsCache(botId);

    // Reload bot to verify
    const updatedBot = await BotSettings.findOne({ botId }).lean() as any;
    
    console.log(`✅ WhatsApp settings saved successfully`);
    console.log(`   Updated WhatsApp:`, JSON.stringify(updatedBot?.whatsapp || {}, null, 2));

    return NextResponse.json({
      success: true,
      webhookUrl: finalWebhookUrl,
      verifyToken: finalVerifyToken,
      phoneInfo,
      message: 'WhatsApp bot activated successfully! Please configure webhook in Meta Business Suite.',
      instructions: [
        '1. Go to Meta Business Suite → WhatsApp → Configuration',
        `2. Add webhook URL: ${finalWebhookUrl}`,
        `3. Set Verify Token: ${finalVerifyToken}`,
        '4. Subscribe to "messages" events',
        '5. Your bot will start receiving messages!'
      ],
      whatsapp: updatedBot?.whatsapp || null
    });
  } catch (error: any) {
    console.error('Error setting WhatsApp webhook:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

