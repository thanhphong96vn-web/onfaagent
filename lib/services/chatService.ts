import OpenAI from 'openai';
import BotSettings from '@/lib/models/BotSettings';
import { IBotSettings } from '@/lib/models/BotSettings';

// Cache for knowledge base to avoid rebuilding on every request
const knowledgeBaseCache = new Map<string, { knowledgeBase: string; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache - increased for better performance

// Cache for system prompts to avoid regenerating
const systemPromptCache = new Map<string, { prompt: string; timestamp: number }>();
const PROMPT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

// Cache for bot settings to reduce database queries
const botSettingsCache = new Map<string, { settings: IBotSettings; timestamp: number }>();
const BOT_SETTINGS_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export interface ChatRequest {
  botId: string;
  message: string;
  platform?: 'website' | 'telegram' | 'facebook' | 'zalo';
  sessionId?: string;
}

export interface ChatResponse {
  reply: string;
  error?: string;
}

/**
 * Build knowledge base from bot settings with caching - OPTIMIZED VERSION
 * Limits content length intelligently to reduce tokens while keeping important info
 */
export function buildKnowledgeBase(botSettings: IBotSettings, maxLength?: number): string {
  // Use cache key based on botId and updatedAt timestamp
  const cacheKey = `${botSettings.botId}_${botSettings.updatedAt?.getTime() || 0}`;
  const cached = knowledgeBaseCache.get(cacheKey);
  
  // Check if cache is valid
  if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
    // If maxLength specified and cached is longer, truncate intelligently
    if (maxLength && cached.knowledgeBase.length > maxLength) {
      return truncateKnowledgeBase(cached.knowledgeBase, maxLength);
    }
    return cached.knowledgeBase;
  }

  let knowledgeBase = '';
  // Increased limits for better knowledge coverage
  const MAX_DOC_LENGTH = maxLength ? Math.min(5000, maxLength / 4) : 5000; // Max chars per document (increased)
  const MAX_URL_LENGTH = maxLength ? Math.min(3000, maxLength / 5) : 3000; // Max chars per URL (increased)
  const MAX_STRUCTURED_LENGTH = maxLength ? Math.min(2000, maxLength / 6) : 2000; // Max chars per structured data (increased)
  const MAX_FAQS_LENGTH = maxLength ? Math.min(8000, maxLength / 2) : 8000; // Max chars for FAQs (increased)

  // Add FAQs - Limit total length for performance
  if (botSettings.faqs.length > 0) {
    let faqsText = botSettings.faqs.join('\n\n');
    if (faqsText.length > MAX_FAQS_LENGTH) {
      faqsText = faqsText.substring(0, MAX_FAQS_LENGTH) + '...[FAQs truncated]';
    }
    knowledgeBase += 'FAQs:\n' + faqsText + '\n\n';
  }

  // Add enabled documents - Load ALL enabled documents (no limit)
  const enabledDocuments = (botSettings.documents?.filter((doc: any) => doc.enabled) || []);
  if (enabledDocuments.length > 0) {
    knowledgeBase += 'Document Knowledge Base:\n';
    enabledDocuments.forEach((doc: any) => {
      const content = doc.content?.length > MAX_DOC_LENGTH 
        ? doc.content.substring(0, MAX_DOC_LENGTH) + '...[content continues]'
        : doc.content || '';
      knowledgeBase += `\n--- ${doc.name} (${doc.type.toUpperCase()}) ---\n`;
      knowledgeBase += content + '\n';
    });
    knowledgeBase += '\n';
  }

  // Add enabled URLs - Load ALL enabled URLs (no limit)
  const enabledUrls = (botSettings.urls?.filter((url: any) => url.enabled) || []);
  if (enabledUrls.length > 0) {
    knowledgeBase += 'Web Content Knowledge Base:\n';
    enabledUrls.forEach((url: any) => {
      const content = url.content?.length > MAX_URL_LENGTH
        ? url.content.substring(0, MAX_URL_LENGTH) + '...[content continues]'
        : url.content || '';
      knowledgeBase += `\n--- ${url.title} (${url.url}) ---\n`;
      knowledgeBase += content + '\n';
    });
    knowledgeBase += '\n';
  }

  // Add enabled structured data - Load ALL enabled structured data (no limit)
  const enabledStructuredData = (botSettings.structuredData?.filter((data: any) => data.enabled) || []);
  if (enabledStructuredData.length > 0) {
    knowledgeBase += 'Structured Data Knowledge Base:\n';
    enabledStructuredData.forEach((data: any) => {
      const dataStr = JSON.stringify(data.data, null, 2);
      const truncatedData = dataStr.length > MAX_STRUCTURED_LENGTH
        ? dataStr.substring(0, MAX_STRUCTURED_LENGTH) + '...[data continues]'
        : dataStr;
      knowledgeBase += `\n--- ${data.name} (${data.type}) ---\n`;
      knowledgeBase += truncatedData + '\n';
    });
    knowledgeBase += '\n';
  }

  if (!knowledgeBase.trim()) {
    knowledgeBase = 'No knowledge base available.';
  }

  // Cache the result
  knowledgeBaseCache.set(cacheKey, {
    knowledgeBase,
    timestamp: Date.now()
  });

  // Clean up old cache entries (keep only last 100)
  if (knowledgeBaseCache.size > 100) {
    const entries = Array.from(knowledgeBaseCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    const toKeep = entries.slice(0, 100);
    knowledgeBaseCache.clear();
    toKeep.forEach(([key, value]) => knowledgeBaseCache.set(key, value));
  }

  // Apply maxLength if specified
  if (maxLength && knowledgeBase.length > maxLength) {
    return truncateKnowledgeBase(knowledgeBase, maxLength);
  }

  return knowledgeBase;
}

/**
 * Intelligently truncate knowledge base while preserving structure
 */
function truncateKnowledgeBase(kb: string, maxLength: number): string {
  if (kb.length <= maxLength) return kb;
  
  // Try to truncate at section boundaries
  const sections = kb.split(/\n---/);
  let result = '';
  
  for (const section of sections) {
    if (result.length + section.length + 10 > maxLength) {
      // Add partial section if there's room
      const remaining = maxLength - result.length - 50;
      if (remaining > 100) {
        result += '\n---' + section.substring(0, remaining) + '...[truncated]';
      }
      break;
    }
    result += (result ? '\n---' : '') + section;
  }
  
  return result + '\n\n[Knowledge base truncated for performance - full content available in cache]';
}

// Reusable OpenAI client instances per API key for connection reuse
const openaiClients = new Map<string, OpenAI>();

/**
 * Get or create OpenAI client with connection reuse
 */
function getOpenAIClient(apiKey: string): OpenAI {
  if (openaiClients.has(apiKey)) {
    return openaiClients.get(apiKey)!;
  }

  const client = new OpenAI({
    apiKey: apiKey,
    timeout: 25000, // 25 second timeout - reduced for faster failure detection
    maxRetries: 1, // Reduced retries for faster response
    // Enable HTTP keep-alive for connection reuse
    httpAgent: undefined, // Let the library handle it
  });

  openaiClients.set(apiKey, client);
  return client;
}

/**
 * Generate system prompt for OpenAI - OPTIMIZED STRUCTURE WITH CACHING
 */
export function generateSystemPrompt(botSettings: IBotSettings, platform?: string, maxKbLength?: number): string {
  // Use cache key based on botId, updatedAt, and platform
  const cacheKey = `${botSettings.botId}_${botSettings.updatedAt?.getTime() || 0}_${platform || 'default'}_${maxKbLength || 'full'}`;
  const cached = systemPromptCache.get(cacheKey);
  
  // Check if cache is valid
  if (cached && Date.now() - cached.timestamp < PROMPT_CACHE_TTL) {
    return cached.prompt;
  }

  // Build knowledge base with optional length limit
  const knowledgeBase = buildKnowledgeBase(botSettings, maxKbLength);
  
  // Debug logging for knowledge base
  console.log(`📚 Knowledge base built:`);
  console.log(`   Length: ${knowledgeBase.length} chars`);
  console.log(`   Preview: ${knowledgeBase.substring(0, 200)}...`);
  console.log(`   Has FAQs: ${knowledgeBase.includes('FAQs:')}`);
  console.log(`   Has Documents: ${knowledgeBase.includes('Document Knowledge Base:')}`);
  console.log(`   Has URLs: ${knowledgeBase.includes('Web Content Knowledge Base:')}`);
  
  const platformContext = platform === 'telegram' 
    ? 'Provide detailed and complete answers based on the knowledge base. Include all relevant information from documents, FAQs, and other sources.'
    : platform === 'facebook' || platform === 'zalo'
    ? 'Be friendly and engaging.'
    : '';

  // Enhanced prompt structure for comprehensive responses
  const prompt = `You are ${botSettings.name}, a helpful and knowledgeable chatbot.

Knowledge Base:
${knowledgeBase}

Instructions:
- Answer questions based EXACTLY on the knowledge base above
- Provide COMPLETE and DETAILED answers with all relevant information
- Include specific details, examples, and explanations from the knowledge base
- If the knowledge base contains information about the topic, provide a thorough answer
- Only say "I don't have that information" if the knowledge base truly doesn't contain relevant information
- Be helpful, friendly, and professional
- For Telegram: Provide detailed answers but organize them clearly
- ${platformContext}`;
  
  // Debug: Log prompt length
  console.log(`📝 System prompt length: ${prompt.length} chars`);

  // Cache the result
  systemPromptCache.set(cacheKey, {
    prompt,
    timestamp: Date.now()
  });

  // Clean up old cache entries (keep only last 50)
  if (systemPromptCache.size > 50) {
    const entries = Array.from(systemPromptCache.entries());
    entries.sort((a, b) => b[1].timestamp - a[1].timestamp);
    const toKeep = entries.slice(0, 50);
    systemPromptCache.clear();
    toKeep.forEach(([key, value]) => systemPromptCache.set(key, value));
  }

  return prompt;
}

/**
 * Process chat message with streaming support (for website)
 */
export async function* processChatMessageStream(
  botSettings: IBotSettings,
  message: string,
  apiKey: string,
  platform?: string
): AsyncGenerator<string, void, unknown> {
  const systemPrompt = generateSystemPrompt(botSettings, platform);
  const openai = getOpenAIClient(apiKey);

  try {
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      max_tokens: 500,
      temperature: 0.7,
      stream: true,
      top_p: 1,
      frequency_penalty: 0,
      presence_penalty: 0,
    });

    for await (const chunk of stream) {
      const content = chunk.choices[0]?.delta?.content || '';
      if (content) {
        yield content;
      }
    }
  } catch (error: any) {
    console.error('Streaming error:', error);
    throw error;
  }
}

/**
 * Process chat message and get AI response - OPTIMIZED VERSION WITH FALLBACK
 */
export async function processChatMessage(
  botSettings: IBotSettings,
  message: string,
  apiKey: string,
  platform?: string
): Promise<string> {
  const openai = getOpenAIClient(apiKey);
  const startTime = Date.now();

  // Try with optimized knowledge base first
  try {
    // Use larger knowledge base for Telegram to include more documents (max 20000 chars)
    const maxKbLength = platform === 'telegram' ? 20000 : undefined;
    const systemPrompt = generateSystemPrompt(botSettings, platform, maxKbLength);
    
    const completion = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: message }
        ],
        max_tokens: 1000, // Increased for detailed responses
        temperature: 0.7,
        stream: false,
        top_p: 0.9,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
      // Reduced timeout - 20 seconds for faster failure detection
      new Promise<never>((_, reject) => 
        setTimeout(() => reject(new Error('OpenAI API timeout after 20 seconds')), 20000)
      )
    ]);

    const elapsed = Date.now() - startTime;
    console.log(`✅ OpenAI API response received in ${elapsed}ms`);
    return completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
  } catch (error: any) {
    // If timeout and prompt is too long, try with shorter knowledge base
    if (error.message?.includes('timeout')) {
      console.warn('⚠️ Timeout with full knowledge base, trying with reduced content...');
      
      try {
        // Try with reduced knowledge base (max 10000 chars) if timeout
        const reducedPrompt = generateSystemPrompt(botSettings, platform, 10000);
        
        const completion = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: reducedPrompt },
              { role: 'user', content: message }
            ],
            max_tokens: 800, // Still allow detailed responses
            temperature: 0.7,
            stream: false,
            top_p: 0.9,
            frequency_penalty: 0,
            presence_penalty: 0,
          }),
          // Longer timeout for fallback - 25 seconds
          new Promise<never>((_, reject) => 
            setTimeout(() => reject(new Error('OpenAI API timeout after 25 seconds')), 25000)
          )
        ]);

        const elapsed = Date.now() - startTime;
        console.log(`✅ OpenAI API response received (fallback) in ${elapsed}ms`);
        return completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';
      } catch (fallbackError: any) {
        console.error('❌ Fallback also failed:', fallbackError);
        throw new Error('Request timeout. Please try again.');
      }
    }
    
    // Better error handling for other errors
    if (error.status === 429) {
      console.error('OpenAI API rate limit:', error);
      throw new Error('Rate limit exceeded. Please try again in a moment.');
    }
    if (error.status === 401 || error.status === 403) {
      console.error('OpenAI API authentication error:', error);
      throw new Error('API key authentication failed.');
    }
    console.error('OpenAI API error:', error);
    throw error;
  }
}

