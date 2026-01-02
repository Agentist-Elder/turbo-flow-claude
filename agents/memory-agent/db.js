const sqlite3 = require('sqlite3').verbose();
const { open } = require('sqlite');

let db;

async function initDB() {
    if (db) return db;
    db = await open({
        filename: './memories.db',
        driver: sqlite3.Database
    });

    // CRITICAL: We enable the 384-dimension schema for BERT
    await db.exec(`
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            vector BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    return db;
}

async function addMemory(text, vector) {
    const db = await initDB();
    
    // Safety Check: Ensure vector is a valid array
    if (!Array.isArray(vector) || vector.length !== 384) {
        console.error(`   ⚠️  VECTOR SIZE MISMATCH! Expected 384, got ${vector ? vector.length : 'undefined'}`);
        // We throw to ensure the agent knows it failed
        throw new Error("Vector dimension mismatch");
    }

    // SQLite stores vectors as JSON text or Blobs. 
    // For simplicity without sqlite-vss extensions, we verify it fits.
    await db.run(
        'INSERT INTO memories (text, vector) VALUES (?, ?)',
        text,
        JSON.stringify(vector)
    );
}

async function getAllMemories() {
    const db = await initDB();
    const rows = await db.all('SELECT * FROM memories');
    return rows.map(row => ({
        ...row,
        vector: JSON.parse(row.vector) // Parse back to array
    }));
}

module.exports = { addMemory, getAllMemories };
