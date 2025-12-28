import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    await connectDB();

    // Get query parameters
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get('page') || '1');
    const limit = parseInt(searchParams.get('limit') || '10');
    const search = searchParams.get('search') || '';
    const sortBy = searchParams.get('sortBy') || 'createdAt';
    const sortOrder = searchParams.get('sortOrder') || 'desc';

    // Calculate offset
    const offset = (page - 1) * limit;

    // Build search query - filter by userId
    let searchQuery: any = { userId: session.user.id };
    if (search) {
      searchQuery = {
        ...searchQuery,
        $or: [
          { name: { $regex: search, $options: 'i' } },
          { botId: { $regex: search, $options: 'i' } },
          { welcomeMessage: { $regex: search, $options: 'i' } }
        ]
      };
    }

    // Build sort object
    const sortObj: any = {};
    sortObj[sortBy] = sortOrder === 'desc' ? -1 : 1;

    // Get total count for pagination
    const totalBots = await BotSettings.countDocuments(searchQuery);
    const totalPages = Math.ceil(totalBots / limit);

    // Get paginated bots - use lean() to get plain objects
    const bots = await BotSettings.find(searchQuery)
      .sort(sortObj)
      .skip(offset)
      .limit(limit)
      .lean();
    
    return NextResponse.json({
      bots,
      pagination: {
        currentPage: page,
        totalPages,
        totalBots,
        limit,
        hasNextPage: page < totalPages,
        hasPrevPage: page > 1
      }
    });
  } catch (error) {
    console.error('Bots API error:', error);
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

    const { botId, name, welcomeMessage, themeColor, webType, faqs, documents, urls, structuredData, categories } = await request.json();

    if (!botId || !name) {
      return NextResponse.json(
        { error: 'Bot ID and name are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Check if bot ID already exists
    const existingBot = await BotSettings.findOne({ botId });
    if (existingBot) {
      return NextResponse.json(
        { error: 'Bot ID already exists' },
        { status: 400 }
      );
    }

    // Create new bot
    const newBot = new BotSettings({
      botId,
      userId: session.user.id,
      name,
      welcomeMessage: welcomeMessage || 'Hello! How can I help you today?',
      themeColor: themeColor || '#3B82F6',
      webType: webType || 'web',
      faqs: faqs || [],
      documents: documents || [],
      urls: urls || [],
      structuredData: structuredData || [],
      categories: categories || []
    });

    await newBot.save();

    return NextResponse.json(newBot);
  } catch (error) {
    console.error('Create bot error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
