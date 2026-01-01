const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Connect to a file-based database
const dbPath = path.resolve(__dirname, 'memory.sqlite');
const db = new sqlite3.Database(dbPath);

// Initialize the Table
db.serialize(() => {
    db.run(`
        CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT NOT NULL,
            vector TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    `);
});

// --- Helper: Save a Memory ---
function addMemory(text, vector) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO memories (text, vector) VALUES (?, ?)");
        // Store vector as a JSON string for simple storage
        stmt.run(text, JSON.stringify(vector), function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
        stmt.finalize();
    });
}

// --- Helper: Get All Memories ---
function getAllMemories() {
    return new Promise((resolve, reject) => {
        db.all("SELECT text, vector FROM memories", (err, rows) => {
            if (err) reject(err);
            else {
                // Convert JSON string back to Array so math works later
                const parsed = rows.map(row => ({
                    text: row.text,
                    vector: JSON.parse(row.vector)
                }));
                resolve(parsed);
            }
        });
    });
}

module.exports = { addMemory, getAllMemories };
