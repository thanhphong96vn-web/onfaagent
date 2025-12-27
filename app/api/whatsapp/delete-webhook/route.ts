import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import { invalidateWhatsAppBotSettingsCache } from '@/lib/services/whatsappService';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId } = await request.json();

    if (!botId) {
      return NextResponse.json(
        { error: 'botId is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Find bot settings
    const botSettings = await BotSettings.findOne({ botId }).lean() as any;
    if (!botSettings) {
      return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
    }

    // Update bot settings to disable WhatsApp
    const db = (await import('mongoose')).connection.db;
    const collectionName = BotSettings.collection.name;
    const collection = db.collection(collectionName);
    
    await collection.updateOne(
      { botId: botSettings.botId },
      {
        $set: {
          'whatsapp.enabled': false
        }
      }
    );

    // Invalidate cache
    invalidateWhatsAppBotSettingsCache(botId);

    console.log(`✅ WhatsApp bot disabled for: ${botId}`);

    return NextResponse.json({
      success: true,
      message: 'WhatsApp bot disabled successfully'
    });
  } catch (error: any) {
    console.error('Error deleting WhatsApp webhook:', error);
    return NextResponse.json(
      { 
        error: 'Internal server error',
        details: error.message 
      },
      { status: 500 }
    );
  }
}

