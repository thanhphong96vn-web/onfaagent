
import { getCryptoPrice } from '../lib/services/cryptoService';

async function testPromptInjection() {
    console.log('--- STARTING DEBUG ---');

    // 1. Simulate fetching crypto data
    const cryptoData = await getCryptoPrice('onfa');
    console.log('Fetched Data:', cryptoData ? 'YES' : 'NO');
    if (cryptoData) console.log(cryptoData);

    // 2. Simulate the prompt string (simplified version of what generateSystemPrompt returns)
    let systemPrompt = `You are a bot.

Knowledge Base:
FAQs:
Q: What is ONFA? A: It is a token.

[End of FAQs]

CRITICAL INSTRUCTIONS: Use Knowledge Base only.`;

    console.log('\n--- ORIGINAL PROMPT ---');
    console.log(systemPrompt);

    // 3. Simulate Injection Logic from chatService.ts
    if (cryptoData) {
        systemPrompt = systemPrompt.replace(
            'Knowledge Base:',
            `Knowledge Base:\n\n${cryptoData}\n\n[End of Real-time Data]\n`
        );
        console.log('\n--- INJECTION SUCCESSFUL? ---');
    }

    console.log('\n--- FINAL PROMPT ---');
    console.log(systemPrompt);

    if (systemPrompt.includes('[REAL-TIME MARKET DATA]')) {
        console.log('\n✅ TEST PASSED: Prompt contains crypto data');
    } else {
        console.log('\n❌ TEST FAILED: Prompt missing crypto data');
    }
}

testPromptInjection();
