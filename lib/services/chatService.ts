import OpenAI from 'openai';
import BotSettings from '@/lib/models/BotSettings';
import { IBotSettings } from '@/lib/models/BotSettings';

// Cache for knowledge base to avoid rebuilding on every request
const knowledgeBaseCache = new Map<string, { knowledgeBase: string; timestamp: number }>();
const CACHE_TTL = 10 * 60 * 1000; // 10 minutes cache - increased for better performance

// Cache for system prompts to avoid regenerating
const systemPromptCache = new Map<string, { prompt: string; timestamp: number }>();
const PROMPT_CACHE_TTL = 10 * 60 * 1000; // 10 minutes

/**
 * Invalidate knowledge base and system prompt caches for a bot
 * Call this when bot settings are updated (documents, URLs, FAQs, etc.)
 */
export function invalidateKnowledgeBaseCache(botId: string): void {
  // Clear all cache entries that match this botId
  const keysToDelete: string[] = [];

  // Clear knowledge base cache
  for (const key of knowledgeBaseCache.keys()) {
    if (key.startsWith(`${botId}_`)) {
      keysToDelete.push(key);
    }
  }
  keysToDelete.forEach(key => knowledgeBaseCache.delete(key));

  // Clear system prompt cache
  const promptKeysToDelete: string[] = [];
  for (const key of systemPromptCache.keys()) {
    if (key.startsWith(`${botId}_`)) {
      promptKeysToDelete.push(key);
    }
  }
  promptKeysToDelete.forEach(key => systemPromptCache.delete(key));

  if (keysToDelete.length > 0 || promptKeysToDelete.length > 0) {
    console.log(`🗑️ Invalidated knowledge base cache for bot: ${botId} (${keysToDelete.length} KB entries, ${promptKeysToDelete.length} prompt entries)`);
  }
}

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
  // Optimized limits for faster processing while maintaining quality
  // FAQs are ALWAYS included in full - no truncation or limits
  const MAX_DOC_LENGTH = maxLength ? Math.min(3000, maxLength / 5) : 3000; // Max chars per document (reduced for speed)
  const MAX_URL_LENGTH = maxLength ? Math.min(2000, maxLength / 6) : 2000; // Max chars per URL (reduced for speed)
  const MAX_STRUCTURED_LENGTH = maxLength ? Math.min(1500, maxLength / 8) : 1500; // Max chars per structured data (reduced)
  const MAX_DOCS_COUNT = maxLength ? (maxLength < 10000 ? 10 : 20) : 20; // Limit number of documents (doubled)
  const MAX_URLS_COUNT = maxLength ? (maxLength < 10000 ? 10 : 20) : 20; // Limit number of URLs (doubled)
  const MAX_STRUCTURED_COUNT = maxLength ? (maxLength < 10000 ? 5 : 10) : 10; // Limit number of structured data

  // Add FAQs - ALWAYS include FULL content, never truncate
  // FAQs are prioritized and must be complete for accurate responses
  if (botSettings.faqs.length > 0) {
    const faqsText = botSettings.faqs.join('\n\n'); // Join all FAQs with double newline
    knowledgeBase += 'FAQs:\n' + faqsText + '\n\n';
    console.log(`📋 FAQs included: ${botSettings.faqs.length} Q&A pairs, ${faqsText.length} characters (FULL content, no truncation)`);
  }

  // Add enabled documents - Limit count for faster processing
  const enabledDocuments = (botSettings.documents?.filter((doc: any) => doc.enabled) || []).slice(0, MAX_DOCS_COUNT);
  if (enabledDocuments.length > 0) {
    knowledgeBase += 'Document Knowledge Base:\n';
    enabledDocuments.forEach((doc: any) => {
      const content = doc.content?.length > MAX_DOC_LENGTH
        ? doc.content.substring(0, MAX_DOC_LENGTH) + '...[content continues]'
        : doc.content || '';
      knowledgeBase += `\n--- ${doc.name} (${doc.type.toUpperCase()}) ---\n`;
      knowledgeBase += content + '\n';
    });
    if ((botSettings.documents?.filter((doc: any) => doc.enabled) || []).length > MAX_DOCS_COUNT) {
      knowledgeBase += `\n[Note: ${(botSettings.documents?.filter((doc: any) => doc.enabled) || []).length - MAX_DOCS_COUNT} more documents available but not included for performance]\n`;
    }
    knowledgeBase += '\n';
  }

  // Add enabled URLs - Limit count for faster processing
  const enabledUrls = (botSettings.urls?.filter((url: any) => url.enabled) || []).slice(0, MAX_URLS_COUNT);
  if (enabledUrls.length > 0) {
    knowledgeBase += 'Web Content Knowledge Base:\n';
    enabledUrls.forEach((url: any) => {
      const content = url.content?.length > MAX_URL_LENGTH
        ? url.content.substring(0, MAX_URL_LENGTH) + '...[content continues]'
        : url.content || '';
      knowledgeBase += `\n--- ${url.title} (${url.url}) ---\n`;
      knowledgeBase += content + '\n';
    });
    if ((botSettings.urls?.filter((url: any) => url.enabled) || []).length > MAX_URLS_COUNT) {
      knowledgeBase += `\n[Note: ${(botSettings.urls?.filter((url: any) => url.enabled) || []).length - MAX_URLS_COUNT} more URLs available but not included for performance]\n`;
    }
    knowledgeBase += '\n';
  }

  // Add enabled structured data - Limit count for faster processing
  const enabledStructuredData = (botSettings.structuredData?.filter((data: any) => data.enabled) || []).slice(0, MAX_STRUCTURED_COUNT);
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
    if ((botSettings.structuredData?.filter((data: any) => data.enabled) || []).length > MAX_STRUCTURED_COUNT) {
      knowledgeBase += `\n[Note: ${(botSettings.structuredData?.filter((data: any) => data.enabled) || []).length - MAX_STRUCTURED_COUNT} more structured data items available but not included for performance]\n`;
    }
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
 * IMPORTANT: FAQs section is ALWAYS preserved in full, never truncated
 */
function truncateKnowledgeBase(kb: string, maxLength: number): string {
  if (kb.length <= maxLength) return kb;

  // Extract FAQs section first - FAQs MUST NEVER be truncated, they are the most important
  const faqsMatch = kb.match(/FAQs:\n([\s\S]*?)(?=\n\n(?:Document|Web Content|Structured Data) Knowledge Base:|$)/);
  const faqsSection = faqsMatch ? `FAQs:\n${faqsMatch[1]}\n\n` : '';
  const kbWithoutFaqs = kb.replace(/FAQs:\n[\s\S]*?\n\n/, '');

  // CRITICAL UPDATE: FAQs are typically prioritized, BUT if they are massive (e.g., > 100k chars),
  // they MUST be truncated to avoid token limits and timeouts.
  const faqsLength = faqsSection.length;

  // We set a hard limit for FAQs to ensure the prompt fits within context.
  const MAX_FAQ_LENGTH = Math.min(maxLength, 30000); // Hard limit for FAQs

  // If FAQs alone exceed maxLength or the hard limit, we MUST truncate them
  if (faqsLength >= MAX_FAQ_LENGTH) {
    console.warn(`⚠️ FAQs section (${faqsLength} chars) exceeds safety limit (${MAX_FAQ_LENGTH} chars) - Truncating FAQs`);
    // Truncate FAQs but keep the structure
    const truncatedFaqs = faqsSection.substring(0, MAX_FAQ_LENGTH) + '...[FAQs truncated due to size limits]\n\n';
    return truncatedFaqs + '\n\n[Note: FAQs were truncated to prevent system timeout. Some information may be missing.]';
  } else if (faqsLength >= maxLength) {
    // If FAQs fit within hard limit but exceed the total requested maxLength, return them (they are high priority)
    // but maybe we should still respect maxLength if it's a fallback retry?
    // If this is a fallback (maxLength < 10000), we should strictly respect it.
    if (maxLength < 10000) {
      console.warn(`⚠️ Fallback mode: FAQs (${faqsLength}) > maxLength (${maxLength}) - Truncating FAQs`);
      const truncatedFaqs = faqsSection.substring(0, maxLength - 200) + '...[truncated]\n\n';
      return truncatedFaqs;
    }

    console.warn(`⚠️ FAQs section (${faqsLength} chars) exceeds maxLength (${maxLength} chars), but returning full FAQs as priority (within safety limit)`);
    return faqsSection + '\n\n[Note: FAQs are prioritized. Other knowledge base sections (URLs, Documents, Structured Data) are excluded to ensure FAQs are available.]';
  }

  // Calculate remaining space for other sections after FAQs
  const remainingLengthForOthers = maxLength - faqsLength - 200; // Reserve 200 for separators/notes

  // If no space left for other sections after FAQs, return FAQs only
  if (remainingLengthForOthers <= 0) {
    console.warn('⚠️ FAQs section takes up all available space, returning FAQs only');
    return faqsSection + '\n\n[Note: FAQs are prioritized. Other knowledge base sections truncated due to size limits]';
  }

  // Truncate other sections (documents, URLs, structured data) intelligently
  // Prioritize URLs over documents and structured data
  const urlSectionMatch = kbWithoutFaqs.match(/Web Content Knowledge Base:\n([\s\S]*?)(?=\n\n(?:Document|Structured Data) Knowledge Base:|$)/);
  const docSectionMatch = kbWithoutFaqs.match(/Document Knowledge Base:\n([\s\S]*?)(?=\n\n(?:Web Content|Structured Data) Knowledge Base:|$)/);
  const structSectionMatch = kbWithoutFaqs.match(/Structured Data Knowledge Base:\n([\s\S]*?)$/);

  let result = faqsSection; // Start with FAQs (NEVER truncated)
  let remainingLength = remainingLengthForOthers; // Use the calculated remainingLengthForOthers

  // Add URLs first (they're important)
  if (urlSectionMatch && remainingLength > 100) {
    const urlSection = `Web Content Knowledge Base:\n${urlSectionMatch[1]}\n\n`;
    if (urlSection.length <= remainingLength) {
      result += urlSection;
      remainingLength -= urlSection.length;
    } else {
      // Truncate URLs section
      const truncatedUrls = urlSection.substring(0, remainingLength - 50) + '...[truncated]\n\n';
      result += truncatedUrls;
      remainingLength = 0;
    }
  }

  // Add Documents if space available
  if (docSectionMatch && remainingLength > 100) {
    const docSection = `Document Knowledge Base:\n${docSectionMatch[1]}\n\n`;
    if (docSection.length <= remainingLength) {
      result += docSection;
      remainingLength -= docSection.length;
    } else {
      const truncatedDocs = docSection.substring(0, remainingLength - 50) + '...[truncated]\n\n';
      result += truncatedDocs;
      remainingLength = 0;
    }
  }

  // Add Structured Data if space available
  if (structSectionMatch && remainingLength > 100) {
    const structSection = `Structured Data Knowledge Base:\n${structSectionMatch[1]}\n\n`;
    if (structSection.length <= remainingLength) {
      result += structSection;
    } else {
      const truncatedStruct = structSection.substring(0, remainingLength - 50) + '...[truncated]\n\n';
      result += truncatedStruct;
    }
  }

  return result.trim() + '\n\n[Note: Knowledge base sections prioritized: FAQs > URLs > Documents > Structured Data]';
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
    timeout: 15000, // 15 second timeout - faster failure detection
    maxRetries: 1, // Reduced retries for faster response
    // Enable HTTP keep-alive for connection reuse
    httpAgent: undefined, // Let the library handle it
  });

  openaiClients.set(apiKey, client);
  return client;
}

/**
 * Detect the language of a message based on character analysis.
 * Returns 'Vietnamese' if Vietnamese diacritical marks are found, otherwise 'English'.
 */
function detectLanguage(text: string): string {
  const vietnamesePattern = /[àáạảãâầấậẩẫăằắặẳẵèéẹẻẽêềếệểễìíịỉĩòóọỏõôồốộổỗơờớợởỡùúụủũưừứựửữỳýỵỷỹđ]/i;
  if (vietnamesePattern.test(text)) return 'Vietnamese';
  return 'English';
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

  // Debug logging for knowledge base with platform context
  const platformTag = platform ? `[${platform.toUpperCase()}]` : '';
  console.log(`${platformTag} 📚 Knowledge base built:`);
  console.log(`${platformTag}    Length: ${knowledgeBase.length} chars`);
  console.log(`${platformTag}    Preview: ${knowledgeBase.substring(0, 200)}...`);
  console.log(`${platformTag}    Has FAQs: ${knowledgeBase.includes('FAQs:')}`);
  console.log(`${platformTag}    Has Documents: ${knowledgeBase.includes('Document Knowledge Base:')}`);
  console.log(`${platformTag}    Has URLs: ${knowledgeBase.includes('Web Content Knowledge Base:')}`);
  console.log(`${platformTag}    Has Structured Data: ${knowledgeBase.includes('Structured Data Knowledge Base:')}`);

  // Unified platform context for all platforms to ensure consistent responses
  // Unified platform context for all platforms to ensure consistent responses
  const platformContext = 'Format your response like a structured report or dashboard. Use horizontal lines to separate sections. Use emojis for every key point. Make it look professional and data-rich.';

  // Enhanced prompt structure with EXTREMELY STRONG emphasis on using knowledge base
  // This prompt is designed to force the AI to search thoroughly before saying "I don't know"
  const prompt = `You are ${botSettings.name}, a helpful and knowledgeable chatbot.

Knowledge Base:
${knowledgeBase}

CRITICAL INSTRUCTIONS - READ CAREFULLY:
1. LANGUAGE MATCHING (HIGHEST PRIORITY): You MUST ALWAYS respond in the SAME language the user writes in. Detect the language of the user's message and use that language for your ENTIRE response — including all headers, labels, bullet points, and conclusions. If the user writes in English, ALL text must be in English. If the user writes in Vietnamese, ALL text must be in Vietnamese. This rule overrides all example templates below. NEVER default to Vietnamese unless the user writes in Vietnamese.
2. MANDATORY SEARCH: You MUST search through the ENTIRE knowledge base above before responding to ANY question
3. USE KNOWLEDGE BASE: The knowledge base contains FAQs, documents, URLs, and structured data - you MUST use them
4. MATCHING LOGIC: If the user's question matches ANY part of the knowledge base (even partial matches, synonyms, or related terms), you MUST provide that information
5. NEVER SAY "I DON'T KNOW" unless you have searched EVERY section (FAQs, Documents, URLs, Structured Data) and found ABSOLUTELY NOTHING related
6. SEARCH EXAMPLES:
   - If user asks "The Golden Era", search for: "Golden Era", "golden era", "Golden", "Era", "NFT", "mining", "khai thác"
   - If user asks "Wonderful Holiday", search for: "Wonderful", "Holiday", "wonderful", "holiday", "NFT", "collection"
   - If user asks about any NFT, search ALL FAQs for that NFT name, related terms, and synonyms
7. ANSWER FORMAT:
   - STRUCTURE: Use a structured, "report-like" format with clear sections.
   - HEADERS: Use emojis + capitalized headers for each section. Write headers in the user's language (e.g., English: "📊 PROFIT CALCULATION", "💰 DETAILS" / Vietnamese: "📊 TÍNH TOÁN LỢI NHUẬN", "💰 THÔNG TIN CHI TIẾT").
   - SEPARATORS: Use dividing lines (e.g., "--------------------") between sections to create a clean visual layout.
   - LISTS: Present data and key points vertically using bullet points. Avoid long paragraphs.
   - EMOJIS: Use relevant emojis for EVERY bullet point to make it visually engaging (e.g., 💵 for money, 📈 for charts, ✅ for results).
   - LENGTH: Do not be afraid to make the response long and vertical. Use whitespace effectively.
8. COMPLETE ANSWERS: Provide complete answers with all relevant details from the knowledge base.
9. BE THOROUGH: Read through ALL FAQs carefully - they contain the most important information.
10. TONE & STYLE: Be professional yet friendly. Use a "Financial Advisor" or "Expert Support" persona.
11. EXAMPLE FORMAT:
   "[Emoji] [HEADER IN USER'S LANGUAGE]
   --------------------
   [Emoji] [Sub-header in user's language]
   - [Emoji] Point 1
   - [Emoji] Point 2: Value

   --------------------
   [Emoji] [Conclusion/Summary in user's language]
   [Text in user's language]"

REMEMBER: The knowledge base above is YOUR ONLY SOURCE OF INFORMATION. If information exists there, you MUST find it and provide it. Only say "I don't have that information" if you have searched EVERYTHING and found NOTHING.

${platformContext}`;

  // Debug: Log prompt length with platform context
  console.log(`${platformTag} 📝 System prompt length: ${prompt.length} chars`);

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
    const userLang = detectLanguage(message);
    const stream = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'system', content: `CRITICAL: The user is writing in ${userLang}. You MUST respond entirely in ${userLang}. Every header, label, bullet point, and sentence must be in ${userLang}.` },
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

  // Check for crypto keywords
  const cryptoKeywords = ['price', 'giá', 'gia', 'oft', 'onfa', 'coin', 'token', 'thị trường', 'market'];
  const lowerMsg = message.toLowerCase();
  let cryptoData = '';

  if (cryptoKeywords.some(k => lowerMsg.includes(k))) {
    try {
      // Dynamically import to avoid circular dependencies if any
      const { getCryptoPrice } = await import('@/lib/services/cryptoService');

      // Attempt to extract coin name dynamically
      let queryCoin = '';
      let calcAmount: number | null = null;
      let calcIntent = false;

      // Regex for Profit Calculation: "interest 1000 OFT", "tính lãi 1000 OFT", "profit 1000 OFT"
      const calcRegex = /(?:calculate|tính|lãi|lãi suất|profit|interest)\s+(?:cho|for)?\s*([\d,.]+)\s*([a-zA-Z0-9\s]+)/i;
      const calcMatch = lowerMsg.match(calcRegex);

      if (calcMatch) {
        calcIntent = true;
        // Remove commas from amount
        const rawAmount = calcMatch[1].replace(/,/g, '');
        calcAmount = parseFloat(rawAmount);
        queryCoin = calcMatch[2].trim();
      } else {
        // Regex for common queries: "price of X", "price X", "giá X", "X price"
        // We look for the keyword and capture the potential coin name
        // Fix: Use \s+ to ensure space, and \b to ensure 'of' is a whole word
        const priceRegex = /(?:price|giá|gia|giá trị|value)\s+(?:(?:\bof\b|của|là)\s+)?([a-zA-Z0-9\s]+)/i;
        const match = lowerMsg.match(priceRegex);

        if (match && match[1]) {
          queryCoin = match[1].trim();
        } else {
          // Fallbacks as before...
          const words = lowerMsg.split(/\s+/);
          if (words.length <= 2) {
            queryCoin = lowerMsg.replace(/price|giá|coin|token/g, '').trim();
          } else {
            if (lowerMsg.includes('oft') || lowerMsg.includes('onfa')) queryCoin = 'onfa';
            else if (lowerMsg.includes('btc') || lowerMsg.includes('bitcoin')) queryCoin = 'bitcoin';
            else if (lowerMsg.includes('eth') || lowerMsg.includes('ethereum')) queryCoin = 'ethereum';
            else if (lowerMsg.includes('bnb')) queryCoin = 'binancecoin';
          }
        }
      }

      // If we extracted a potential coin name, query it
      if (queryCoin && queryCoin.length > 1 && queryCoin.length < 20) {
        console.log(`🔍 Detected crypto query for: ${queryCoin} (Intent: ${calcIntent ? 'Calculation' : 'Price'})`);
        const priceInfo = await getCryptoPrice(queryCoin);

        if (priceInfo) {
          cryptoData = priceInfo;

          // If Calculation Intent, we perform additional math and prep extra context
          if (calcIntent && calcAmount !== null && !isNaN(calcAmount)) {
            // Extract price from the formatted string (e.g. Price: $0.70)
            const priceMatch = priceInfo.match(/Price: \$([\d,.]+)/);
            const currentPrice = priceMatch ? parseFloat(priceMatch[1].replace(/,/g, '')) : 0;
            const totalValue = currentPrice * calcAmount;

            const calcContext = `
[🧮 PROFIT CALCULATION REQUEST DATA]
- User wants to calculate profit for: ${calcAmount.toLocaleString()} ${queryCoin.toUpperCase()}
- Current Price: $${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
- Total Initial Value (Deposit): $${totalValue.toLocaleString(undefined, { minimumFractionDigits: 2 })}
- INSTRUCTION: 
  1. Use the "Knowledge Base" to find current Interest Rates and Terms for ${queryCoin}.
  2. If found, calculate the estimated profit.
  3. LANGUAGE: Respond in the SAME language the user wrote in. Use the format below but translate ALL labels to match the user's language.
  4. Respond using the STRICT FORMAT below:
  
  📊 [Estimated Profit Calculation / Tính Toán Lợi Nhuận Dự Kiến]
  --------------------
  💰 [Deposit Info / Thông Tin Deposit]
  - Token: ${queryCoin.toUpperCase()}
  - [Quantity / Số lượng]: ${calcAmount.toLocaleString()} ${queryCoin.toUpperCase()}
  - [Current Price / Giá hiện tại]: $${currentPrice} /token
  - [USD Value / Giá trị USD]: $${totalValue.toLocaleString()}

  📈 [Profit Info / Thông Tin Lợi Nhuận]
  - [Term / Kỳ hạn]: [Found in KB]
  - [Interest Rate / Lãi suất]: [Found in KB]
  
  ✅ [Results After Term / Kết Quả Sau Kỳ Hạn]
  - [Profit / Lợi nhuận]: [Calculate: Value * Rate]
  - [Total Received / Tổng nhận]: [Calculate: Value + Profit]

  📝 [Balance between profit and risk / Cân bằng giữa lợi nhuận và rủi ro]
`;
            cryptoData += calcContext;
          }

          console.log(`✅ Injected crypto data for ${queryCoin}`);
        }
      }

    } catch (err) {
      console.error('Error fetching crypto data:', err);
    }
  }

  // Detect user language for response language matching
  const userLang = detectLanguage(message);
  const langMessage = `CRITICAL: The user is writing in ${userLang}. You MUST respond entirely in ${userLang}. Every header, label, bullet point, and sentence must be in ${userLang}.`;

  // Try with optimized knowledge base first
  try {
    // Use unified knowledge base size for all platforms to ensure consistent responses
    // Increased to 50000 to ensure FAQs (338 items = ~34k chars) are NEVER truncated
    // FAQs are the most important and must be included in full for accurate responses
    const maxKbLength = 50000; // Increased limit to ensure FAQs are never truncated
    let systemPrompt = generateSystemPrompt(botSettings, platform, maxKbLength);

    // Inject crypto data if available
    // CRITICAL UPDATE: We PREPEND the data to the prompt to ensure it's the first thing the AI sees.
    // We also add a specific instruction to prioritize this data.
    if (cryptoData) {
      const cryptoInjection = `
[🚨 LIVE MARKET DATA - HIGH PRIORITY]
${cryptoData}
[INSTRUCTION: Use the above Live Market Data to answer questions about price/market. It overrides any other information.]
[NOTE: OFT is the ticker symbol for ONFA. If user asks about OFT, use the ONFA data above.]
[FORMATTING REQUIREMENT: You MUST use the following format for ANY coin price response.]
[CRITICAL: Do not add any extra dashes or lines at the very bottom.]
[CRITICAL: Bold ONLY the keys, NOT the values.]
[LANGUAGE RULE: ALL labels below MUST be written in the SAME language the user used. If user writes in English, use English labels. If user writes in Vietnamese, use Vietnamese labels.]

📊 [PRICE OF / GIÁ] [TOKEN NAME] ([SYMBOL])
--------------------
• **[Current Price / Giá hiện tại]:** $[Price]
• **[24h Change / Thay đổi trong 24 giờ]:** [Change]% [Trend Emoji]
• **[Updated / Cập nhật]:** [Time] ([Source / Nguồn]: CoinGecko)

--------------------
💡 [Additional Info / Thông tin bổ sung]
• [Write 1-2 positive/neutral sentences about the trend IN THE USER'S LANGUAGE]

--------------------
📈 [Conclusion / Kết luận]
[Summary sentence about the price action IN THE USER'S LANGUAGE]

[Closing message in the user's language]
---------------------------------------------------
`;
      systemPrompt = cryptoInjection + systemPrompt;
      console.log('✅ Injected crypto data at START of system prompt');
    }


    const completion = await Promise.race([
      openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'system', content: langMessage },
          { role: 'user', content: message }
        ],
        max_tokens: 500, // Reduced from 600 to 500 for faster generation
        temperature: 0.7,
        stream: false,
        top_p: 0.9,
        frequency_penalty: 0,
        presence_penalty: 0,
      }),
      // Reduced timeout - 15 seconds for faster failure detection
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error('OpenAI API timeout after 15 seconds')), 15000)
      )
    ]);

    const elapsed = Date.now() - startTime;
    const platformTag = platform ? `[${platform.toUpperCase()}]` : '';
    console.log(`${platformTag} ✅ OpenAI API response received in ${elapsed}ms`);

    // Normalize response text: remove excessive line breaks
    let response = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

    // Normalize multiple consecutive newlines (3+ newlines become 2, 2+ newlines become 1)
    // This prevents excessive spacing while preserving intentional paragraph breaks
    response = response.replace(/\n{3,}/g, '\n\n'); // 3+ newlines -> 2 newlines
    response = response.replace(/\n{2}/g, '\n'); // 2 newlines -> 1 newline

    // Trim leading/trailing whitespace and newlines
    response = response.trim();

    return response;
  } catch (error: any) {
    // If timeout and prompt is too long, try with shorter knowledge base
    if (error.message?.includes('timeout')) {
      console.warn('⚠️ Timeout with full knowledge base, trying with reduced content...');

      try {
        // Try with reduced knowledge base (max 6000 chars) if timeout - faster fallback
        const reducedPrompt = generateSystemPrompt(botSettings, platform, 6000);

        const completion = await Promise.race([
          openai.chat.completions.create({
            model: 'gpt-4o-mini',
            messages: [
              { role: 'system', content: reducedPrompt },
              { role: 'system', content: `CRITICAL: The user is writing in ${userLang}. You MUST respond entirely in ${userLang}. Every header, label, bullet point, and sentence must be in ${userLang}.` },
              { role: 'user', content: message }
            ],
            max_tokens: 400, // Reduced for faster fallback responses
            temperature: 0.7,
            stream: false,
            top_p: 0.9,
            frequency_penalty: 0,
            presence_penalty: 0,
          }),
          // Reduced timeout for fallback - 15 seconds
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('OpenAI API timeout after 15 seconds')), 15000)
          )
        ]);

        const elapsed = Date.now() - startTime;
        console.log(`✅ OpenAI API response received (fallback) in ${elapsed}ms`);

        // Normalize response text: remove excessive line breaks
        let response = completion.choices[0]?.message?.content || 'Sorry, I could not generate a response.';

        // Normalize multiple consecutive newlines (3+ newlines become 2, 2+ newlines become 1)
        response = response.replace(/\n{3,}/g, '\n\n'); // 3+ newlines -> 2 newlines
        response = response.replace(/\n{2}/g, '\n'); // 2 newlines -> 1 newline

        // Trim leading/trailing whitespace and newlines
        response = response.trim();

        return response;
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

