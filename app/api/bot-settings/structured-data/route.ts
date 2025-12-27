import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import { invalidateBotSettingsCache } from '@/lib/services/telegramService';
import { invalidateKnowledgeBaseCache } from '@/lib/services/chatService';
import { invalidateWhatsAppWebBotSettingsCache } from '@/lib/services/whatsappWebService';
import { v4 as uuidv4 } from 'uuid';

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, name, type, data, category, tags } = await request.json();

    if (!botId || !name || !type || !data) {
      return NextResponse.json(
        { error: 'Bot ID, name, type, and data are required' },
        { status: 400 }
      );
    }

    // Validate type
    const validTypes = ['products', 'pricing', 'services', 'catalog'];
    if (!validTypes.includes(type)) {
      return NextResponse.json(
        { error: 'Invalid type. Must be one of: products, pricing, services, catalog' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if bot exists
    const botSettings = await BotSettings.findOne({ botId });
    if (!botSettings) {
      return NextResponse.json(
        { error: 'Bot not found' },
        { status: 404 }
      );
    }

    // Create structured data source
    const structuredDataSource = {
      id: uuidv4(),
      name: name,
      type: type as 'products' | 'pricing' | 'services' | 'catalog',
      data: data,
      enabled: true,
      category: category || 'General',
      tags: tags ? tags.split(',').map((tag: string) => tag.trim()) : [],
      createdAt: new Date()
    };

    // Add structured data to bot settings and update updatedAt
    await BotSettings.findOneAndUpdate(
      { botId },
      { 
        $push: { structuredData: structuredDataSource },
        $addToSet: { categories: category || 'General' },
        $set: { updatedAt: new Date() } // Force update updatedAt to invalidate cache
      }
    );

    // Invalidate all caches when settings are updated
    invalidateBotSettingsCache(botId);
    invalidateWhatsAppWebBotSettingsCache(botId);
    invalidateKnowledgeBaseCache(botId);
    console.log(`✅ Invalidated all caches for bot: ${botId}`);

    return NextResponse.json({ 
      success: true, 
      structuredData: structuredDataSource 
    });

  } catch (error) {
    console.error('Structured data creation error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, dataId } = await request.json();

    if (!botId || !dataId) {
      return NextResponse.json(
        { error: 'Bot ID and data ID are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Remove structured data from bot settings and update updatedAt
    await BotSettings.findOneAndUpdate(
      { botId },
      { 
        $pull: { structuredData: { id: dataId } },
        $set: { updatedAt: new Date() } // Force update updatedAt to invalidate cache
      }
    );

    // Invalidate all caches when settings are updated
    invalidateBotSettingsCache(botId);
    invalidateWhatsAppWebBotSettingsCache(botId);
    invalidateKnowledgeBaseCache(botId);
    console.log(`✅ Invalidated all caches for bot: ${botId}`);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Structured data deletion error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}

export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { botId, dataId, enabled, category, tags, data } = await request.json();

    if (!botId || !dataId) {
      return NextResponse.json(
        { error: 'Bot ID and data ID are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Update structured data settings
    const updateData: any = { updatedAt: new Date() }; // Force update updatedAt to invalidate cache
    if (enabled !== undefined) updateData['structuredData.$.enabled'] = enabled;
    if (category !== undefined) updateData['structuredData.$.category'] = category;
    if (tags !== undefined) updateData['structuredData.$.tags'] = tags;
    if (data !== undefined) updateData['structuredData.$.data'] = data;

    await BotSettings.findOneAndUpdate(
      { botId, 'structuredData.id': dataId },
      { $set: updateData }
    );

    // Invalidate all caches when settings are updated
    invalidateBotSettingsCache(botId);
    invalidateWhatsAppWebBotSettingsCache(botId);
    invalidateKnowledgeBaseCache(botId);
    console.log(`✅ Invalidated all caches for bot: ${botId}`);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Structured data update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
