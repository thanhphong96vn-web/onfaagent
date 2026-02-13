
// Mock function to simulate extraction logic from chatService.ts
function extractCoin(message) {
    const lowerMsg = message.toLowerCase();
    let queryCoin = '';

    const priceRegex = /(?:price|giá|giá trị|value)\s+(?:(?:\bof\b|của|là)\s+)?([a-zA-Z0-9\s]+)/i;
    const match = lowerMsg.match(priceRegex);

    if (match && match[1]) {
        queryCoin = match[1].trim();
    } else {
        const words = lowerMsg.split(/\s+/);
        if (words.length <= 2) {
            queryCoin = lowerMsg.replace(/price|giá|coin|token/g, '').trim();
        } else {
            if (lowerMsg.includes('oft') || lowerMsg.includes('onfa')) queryCoin = 'onfa';
            else if (lowerMsg.includes('btc') || lowerMsg.includes('bitcoin')) queryCoin = 'bitcoin';
            else if (lowerMsg.includes('eth') || lowerMsg.includes('ethereum')) queryCoin = 'ethereum';
        }
    }
    return queryCoin;
}

// Test cases
const tests = [
    "price of bitcoin",
    "giá oft",
    "giá của eth",
    "btc price",
    "onfa",
    "xrp"
];

tests.forEach(t => {
    console.log(`Query: "${t}" -> Extracted: "${extractCoin(t)}"`);
});
