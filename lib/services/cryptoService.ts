
import axios from 'axios';

// Cache interface
interface PriceCache {
    data: any;
    timestamp: number;
}

// Cache storage
const priceCache: Map<string, PriceCache> = new Map();
const CACHE_TTL = 60 * 1000; // 1 minute cache

// Mapping of symbols/names to CoinGecko IDs
// "onfa" might not be the ID, so we might need to search or use a specific ID if provided.
// For now, assuming 'onfa' maps to a specific ID or we fallback to search.
// If 'onfa' isn't on CoinGecko yet, we might need a custom source.
// But per user request, we use CoinGecko.
const COIN_MAPPING: Record<string, string> = {
    'onfa': 'onfa', // Replace with actual ID if known, e.g., 'bitcoin', 'ethereum'
    'oft': 'onfa',
    'btc': 'bitcoin',
    'eth': 'ethereum',
    'bnb': 'binancecoin',
    'usdt': 'tether'
};

const COINGECKO_API_KEY = process.env.COINGECKO_API_KEY || ''; // From .env.local

/**
 * Get crypto price from CoinGecko
 */
export async function getCryptoPrice(query: string): Promise<string | null> {
    // Normalize query
    const cleanQuery = query.toLowerCase().trim();
    const coinId = COIN_MAPPING[cleanQuery] || cleanQuery;

    // Check cache
    const cached = priceCache.get(coinId);
    if (cached && Date.now() - cached.timestamp < CACHE_TTL) {
        return formatPriceData(cached.data, coinId);
    }

    try {
        // We use the 'simple/price' endpoint for efficiency
        // vs 'coins/markets' which gives more data but heavier
        const response = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
            params: {
                ids: coinId,
                vs_currencies: 'usd',
                include_24hr_change: true,
                include_last_updated_at: true,
                x_cg_demo_api_key: COINGECKO_API_KEY // Pass API key in params as fallback
            },
            headers: {
                'x-cg-demo-api-key': COINGECKO_API_KEY // Pass API key in headers
            },
            timeout: 5000
        });

        const data = response.data[coinId];

        if (!data) {
            // Try searching if direct ID failed
            // This is a fallback and heavier operation
            return await searchAndGetPrice(cleanQuery);
        }

        // Cache result
        priceCache.set(coinId, {
            data: data,
            timestamp: Date.now()
        });

        return formatPriceData(data, coinId);

    } catch (error) {
        console.error(`Error fetching crypto price for ${coinId}:`, error);
        return null;
    }
}

async function searchAndGetPrice(query: string): Promise<string | null> {
    try {
        const searchRes = await axios.get('https://api.coingecko.com/api/v3/search', {
            params: {
                query: query,
                x_cg_demo_api_key: COINGECKO_API_KEY
            },
            headers: {
                'x-cg-demo-api-key': COINGECKO_API_KEY
            },
            timeout: 5000
        });

        const coin = searchRes.data.coins?.[0];
        if (!coin) return null;

        // Found a coin, now fetch price
        const coinId = coin.id;
        return await getCryptoPrice(coinId);
    } catch (error) {
        console.error(`Error searching crypto ID for ${query}:`, error);
        return null;
    }
}

function formatPriceData(data: any, coinId: string): string {
    if (!data) return '';

    const price = data.usd;
    const change24h = data.usd_24h_change;
    const time = new Date(data.last_updated_at * 1000).toLocaleString('vi-VN'); // Vietnamese data format for user context

    let simpleId = coinId.toUpperCase();
    // EXPLICIT MAPPING FOR USER CONTEXT
    if (coinId === 'onfa') simpleId = 'ONFA (OFT)';

    const trend = change24h >= 0 ? '📈' : '📉';
    const sign = change24h >= 0 ? '+' : '';

    return `
[REAL-TIME MARKET DATA]
- Token: ${simpleId}
- Price: $${price}
- 24h Change: ${sign}${change24h?.toFixed(2)}% ${trend}
- Updated: ${time} (Source: CoinGecko)
`;
}
