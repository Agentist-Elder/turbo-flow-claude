const sqlite3 = require('sqlite3').verbose();
const path = require('path'); // Import path module

// FIX: Always locate memories.db in THIS folder, not where the command is run from
const dbPath = path.join(__dirname, 'memories.db');
const db = new sqlite3.Database(dbPath);

function initDB() {
    db.serialize(() => {
        db.run(`CREATE TABLE IF NOT EXISTS memories (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            text TEXT,
            vector BLOB,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);
    });
}

// Convert Float32Array to Buffer (BLOB) for storage
function float32ToBuffer(floatArray) {
    return Buffer.from(floatArray.buffer);
}

// Convert Buffer (BLOB) back to Float32Array
function bufferToFloat32(buffer) {
    return new Float32Array(
        buffer.buffer,
        buffer.byteOffset,
        buffer.byteLength / 4
    );
}

function addMemory(text, vector) {
    return new Promise((resolve, reject) => {
        const stmt = db.prepare("INSERT INTO memories (text, vector) VALUES (?, ?)");
        const vectorBlob = float32ToBuffer(vector);
        
        stmt.run(text, vectorBlob, function(err) {
            if (err) reject(err);
            else resolve(this.lastID);
        });
        stmt.finalize();
    });
}

function getAllMemories() {
    return new Promise((resolve, reject) => {
        db.all("SELECT * FROM memories", (err, rows) => {
            if (err) {
                reject(err);
            } else {
                const results = rows.map(row => ({
                    ...row,
                    vector: bufferToFloat32(row.vector)
                }));
                resolve(results);
            }
        });
    });
}

// Initialize on load
initDB();

module.exports = {
    addMemory,
    getAllMemories
};
