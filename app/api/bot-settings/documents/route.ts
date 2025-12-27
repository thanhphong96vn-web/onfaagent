import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import connectDB from '@/lib/db';
import BotSettings from '@/lib/models/BotSettings';
import { invalidateBotSettingsCache } from '@/lib/services/telegramService';
import { invalidateKnowledgeBaseCache } from '@/lib/services/chatService';
import { invalidateWhatsAppWebBotSettingsCache } from '@/lib/services/whatsappWebService';
import { v4 as uuidv4 } from 'uuid';
import mammoth from 'mammoth';
import { extractText } from 'unpdf';

// Configure runtime for Node.js
export const runtime = 'nodejs';

// Function to extract text from PDF using unpdf
async function extractTextFromPDF(buffer: Buffer): Promise<string> {
  try {
    // Convert Buffer to Uint8Array as required by unpdf
    const uint8Array = new Uint8Array(buffer);
    const result = await extractText(uint8Array);
    const fullText = result.text.join('\n');
    return fullText.trim();
  } catch (error) {
    console.error('PDF extraction error:', error);
    throw new Error('Failed to extract text from PDF');
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const formData = await request.formData();
    const botId = formData.get('botId') as string;
    const file = formData.get('file') as File;
    const category = formData.get('category') as string;
    const tags = formData.get('tags') as string;

    if (!botId || !file) {
      return NextResponse.json(
        { error: 'Bot ID and file are required' },
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

    // Extract text content based on file type
    let content = '';
    const fileName = file.name;
    const fileType = fileName.split('.').pop()?.toLowerCase();

    if (fileType === 'pdf') {
      console.log('Processing PDF file:', fileName);
      
      try {
        const buffer = Buffer.from(await file.arrayBuffer());
        console.log('PDF buffer size:', buffer.length);
        
        const extractedText = await extractTextFromPDF(buffer);
        console.log('PDF text extracted successfully, length:', extractedText.length);
        
        if (extractedText && extractedText.trim().length > 0) {
          content = `[PDF Document: ${fileName}]\n\n${extractedText}`;
        } else {
          content = `[PDF Document: ${fileName}]\n\nThis PDF document has been uploaded successfully. The text extraction found limited readable content. For better results, please convert this PDF to TXT or DOCX format and re-upload.`;
        }
      } catch (error) {
        console.error('PDF processing error:', error);
        content = `[PDF Document: ${fileName}]\n\nThis PDF document has been uploaded successfully. For full text extraction and AI processing, please convert this PDF to TXT or DOCX format and re-upload.`;
      }
    } else if (fileType === 'docx') {
      const buffer = Buffer.from(await file.arrayBuffer());
      const result = await mammoth.extractRawText({ buffer });
      content = result.value;
    } else if (fileType === 'txt') {
      content = await file.text();
    } else {
      return NextResponse.json(
        { error: 'Unsupported file type. Only PDF, DOCX, and TXT files are supported.' },
        { status: 400 }
      );
    }

    // Create document source
    const documentSource = {
      id: uuidv4(),
      name: fileName,
      type: fileType as 'pdf' | 'docx' | 'txt',
      content: content,
      enabled: true,
      category: category || 'General',
      tags: tags ? tags.split(',').map((tag: string) => tag.trim()) : [],
      uploadedAt: new Date()
    };

    // Add document to bot settings and update updatedAt
    await BotSettings.findOneAndUpdate(
      { botId },
      { 
        $push: { documents: documentSource },
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
      document: documentSource 
    });

  } catch (error) {
    console.error('Document upload error:', error);
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

    const { botId, documentId } = await request.json();

    if (!botId || !documentId) {
      return NextResponse.json(
        { error: 'Bot ID and document ID are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Remove document from bot settings and update updatedAt
    await BotSettings.findOneAndUpdate(
      { botId },
      { 
        $pull: { documents: { id: documentId } },
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
    console.error('Document deletion error:', error);
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

    const { botId, documentId, enabled, category, tags } = await request.json();

    if (!botId || !documentId) {
      return NextResponse.json(
        { error: 'Bot ID and document ID are required' },
        { status: 400 }
      );
    }

    await connectDB();

    // Update document settings
    const updateData: any = { updatedAt: new Date() }; // Force update updatedAt to invalidate cache
    if (enabled !== undefined) updateData['documents.$.enabled'] = enabled;
    if (category !== undefined) updateData['documents.$.category'] = category;
    if (tags !== undefined) updateData['documents.$.tags'] = tags;

    await BotSettings.findOneAndUpdate(
      { botId, 'documents.id': documentId },
      { $set: updateData }
    );

    // Invalidate all caches when settings are updated
    invalidateBotSettingsCache(botId);
    invalidateWhatsAppWebBotSettingsCache(botId);
    invalidateKnowledgeBaseCache(botId);
    console.log(`✅ Invalidated all caches for bot: ${botId}`);

    return NextResponse.json({ success: true });

  } catch (error) {
    console.error('Document update error:', error);
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
