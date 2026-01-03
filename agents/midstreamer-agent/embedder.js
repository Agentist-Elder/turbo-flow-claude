import { pipeline } from '@xenova/transformers';

let embedder = null;

/**
 * Initialize the embedder model lazily
 * Uses Xenova/all-MiniLM-L6-v2 for local CPU-based embeddings
 * @returns {Promise<Pipeline>} The initialized embedder pipeline
 */
async function initEmbedder() {
    if (!embedder) {
        try {
            console.log('[Embedder] Loading Xenova/all-MiniLM-L6-v2 model...');
            embedder = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
            console.log('[Embedder] Model loaded successfully');
        } catch (error) {
            console.error('[Embedder] Failed to load model:', error);
            throw new Error(`Failed to initialize embedder: ${error.message}`);
        }
    }
    return embedder;
}

/**
 * Generate 384-dimensional embeddings for the given text
 * Runs entirely on CPU using local transformer model - NO external API calls
 *
 * @param {string} text - The input text to embed
 * @returns {Promise<Float32Array>} 384-dimensional embedding vector
 * @throws {Error} If text is invalid or embedding generation fails
 */
async function getEmbedding(text) {
    // Validate input
    if (!text || typeof text !== 'string') {
        throw new Error('Invalid input: text must be a non-empty string');
    }

    if (text.trim().length === 0) {
        throw new Error('Invalid input: text cannot be empty or whitespace only');
    }

    try {
        // Initialize model if needed
        const model = await initEmbedder();

        // Generate embeddings with mean pooling and normalization
        const output = await model(text, {
            pooling: 'mean',
            normalize: true
        });

        // Convert to Float32Array (384 dimensions for all-MiniLM-L6-v2)
        const embedding = new Float32Array(output.data);

        // Verify dimensions
        if (embedding.length !== 384) {
            console.warn(`[Embedder] Unexpected embedding dimension: ${embedding.length}, expected 384`);
        }

        return embedding;
    } catch (error) {
        console.error('[Embedder] Failed to generate embedding:', error);
        throw new Error(`Embedding generation failed: ${error.message}`);
    }
}

/**
 * Reset the embedder (useful for testing or forced reinitialization)
 */
function resetEmbedder() {
    embedder = null;
    console.log('[Embedder] Model reset - will reinitialize on next use');
}

export { getEmbedding, resetEmbedder };
