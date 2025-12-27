import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import { invalidateBotSettingsCache } from '@/lib/services/telegramService';
import { invalidateKnowledgeBaseCache } from '@/lib/services/chatService';
import { invalidateWhatsAppWebBotSettingsCache } from '@/lib/services/whatsappWebService';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const botId = searchParams.get('botId');

    await connectDB();

    if (botId) {
      // Get specific bot settings - use lean() to get plain object
      const botSettings = await BotSettings.findOne({ botId }).lean();
      if (!botSettings) {
        return NextResponse.json({ error: 'Bot not found' }, { status: 404 });
      }
      return NextResponse.json(botSettings);
    } else {
      // Get all bots (for backward compatibility)
      const botSettings = await BotSettings.findOne({}).lean();
      return NextResponse.json(botSettings);
    }

  } catch (error) {
    console.error('Error fetching bot settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, name, welcomeMessage, themeColor, faqs, documents, urls, structuredData, categories, whatsapp } = await request.json();

    if (!botId) {
      return NextResponse.json(
        { error: 'Bot ID is required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Build base update data
    const updateData: any = {
      botId,
      name: name || 'AI Assistant',
      welcomeMessage: welcomeMessage || 'Hello! How can I help you today?',
      themeColor: themeColor || '#3B82F6',
      faqs: faqs || [],
      documents: documents || [],
      urls: urls || [],
      structuredData: structuredData || [],
      categories: categories || []
      // Note: telegram and messenger fields are NOT included here to preserve existing settings
    };

    // Upsert bot settings first
    let botSettings = await BotSettings.findOneAndUpdate(
      { botId },
      { $set: updateData },
      { upsert: true, new: true }
    );

    // If whatsapp field is provided, update it separately to preserve existing whatsapp settings
    if (whatsapp !== undefined) {
      // Get existing whatsapp settings
      const existingBot = await BotSettings.findOne({ botId }).lean() as any;
      const existingWhatsapp = existingBot?.whatsapp || {};
      
      // Merge existing whatsapp settings with new ones
      const updatedWhatsapp = { ...existingWhatsapp, ...whatsapp };
      
      // Use MongoDB native update for nested whatsapp field
      const mongooseConnection = await connectDB();
      if (mongooseConnection?.connection?.db) {
        const db = mongooseConnection.connection.db;
        const collection = db.collection(BotSettings.collection.name);
        
        await collection.updateOne(
          { botId },
          { $set: { 'whatsapp': updatedWhatsapp } }
        );
        
        console.log(`✅ WhatsApp settings updated for bot: ${botId}`);
        console.log(`   Updated whatsapp:`, JSON.stringify(updatedWhatsapp, null, 2));
      }
      
      // Reload bot to get updated whatsapp settings
      botSettings = await BotSettings.findOne({ botId });
    }

    // Invalidate all caches when settings are updated
    invalidateBotSettingsCache(botId);
    invalidateWhatsAppWebBotSettingsCache(botId);
    invalidateKnowledgeBaseCache(botId);
    console.log(`✅ Invalidated all caches for bot: ${botId}`);

    return NextResponse.json(botSettings);

  } catch (error) {
    console.error('Error saving bot settings:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
