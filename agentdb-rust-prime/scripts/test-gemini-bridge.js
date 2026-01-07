#!/usr/bin/env node
/**
 * Test Script: Send message to Gemini 2.0 Flash
 * Purpose: Verify the bridge communication is operational
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

async function testGeminiBridge() {
    console.log('=== Gemini Bridge Test ===\n');

    // Check for API key
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
        console.error('❌ ERROR: No API key found!');
        console.error('Please set GEMINI_API_KEY or GOOGLE_API_KEY environment variable');
        console.error('\nExample:');
        console.error('  export GEMINI_API_KEY="your-api-key-here"');
        process.exit(1);
    }

    try {
        // Initialize Gemini AI
        console.log('📡 Initializing Gemini 2.0 Flash connection...');
        const genAI = new GoogleGenerativeAI(apiKey);

        // Use Gemini 2.0 Flash model
        const model = genAI.getGenerativeModel({
            model: 'gemini-2.0-flash-exp'  // Gemini 2.0 Flash experimental model
        });

        // Test message
        const testMessage = 'Bridge Operational';
        console.log(`📤 Sending message: "${testMessage}"\n`);

        // Send message
        const result = await model.generateContent(testMessage);
        const response = await result.response;
        const text = response.text();

        // Display results
        console.log('✅ SUCCESS: Message sent and response received!\n');
        console.log('=== Gemini Response ===');
        console.log(text);
        console.log('======================\n');

        // Verify the message was processed
        console.log('✅ Bridge Operational - Communication confirmed');

        return {
            success: true,
            message: testMessage,
            response: text,
            timestamp: new Date().toISOString()
        };

    } catch (error) {
        console.error('❌ ERROR: Communication failed');
        console.error('Error details:', error.message);

        if (error.message.includes('API key')) {
            console.error('\n💡 Tip: Check your API key is valid and has access to Gemini models');
        }

        return {
            success: false,
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
}

// Run the test
if (require.main === module) {
    testGeminiBridge()
        .then(result => {
            console.log('\n=== Test Summary ===');
            console.log(JSON.stringify(result, null, 2));
            process.exit(result.success ? 0 : 1);
        })
        .catch(err => {
            console.error('Fatal error:', err);
            process.exit(1);
        });
}

module.exports = { testGeminiBridge };
