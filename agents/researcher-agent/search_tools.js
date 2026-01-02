const axios = require('axios');

async function searchWeb(query) {
    try {
        console.log(`   🔎 Checking Wikipedia API for: "${query}"...`);

        // 1. Define our ID Card (User-Agent) to prevent blocking
        const headers = {
            'User-Agent': 'TurboFlowBot/1.0 (research-agent; bot@example.com)'
        };

        // 2. Step 1: Search for the best matching page title
        // We use the "opensearch" API which is very forgiving with queries
        const searchUrl = `https://en.wikipedia.org/w/api.php?action=opensearch&search=${encodeURIComponent(query)}&limit=1&namespace=0&format=json`;

        const searchRes = await axios.get(searchUrl, { headers });

        // Opensearch returns: [query, [titles], [descriptions], [urls]]
        if (!searchRes.data[1] || searchRes.data[1].length === 0) {
            return "No Wikipedia articles found.";
        }

        const bestTitle = searchRes.data[1][0];
        const bestUrl = searchRes.data[3][0];

        // 3. Step 2: Get the summary for that specific page
        const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(bestTitle)}`;
        const summaryRes = await axios.get(summaryUrl, { headers });

        return `[SOURCE]: Wikipedia\n[TITLE]: ${bestTitle}\n[SUMMARY]: ${summaryRes.data.extract}\n[LINK]: ${bestUrl}`;

    } catch (e) {
        return `Research Error: ${e.message}`;
    }
}

module.exports = { searchWeb };
