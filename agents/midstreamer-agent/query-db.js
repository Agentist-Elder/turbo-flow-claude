/**
 * Database Query Script - Check Immunity Signatures
 */

import sqlite3Pkg from 'sqlite3';
const sqlite3 = sqlite3Pkg.verbose();
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbPath = path.join(__dirname, '../memory-agent/memories.db');

const db = new sqlite3.Database(dbPath);

console.log("\n🔍 IMMUNITY DATABASE ANALYSIS");
console.log("=" + "=".repeat(60) + "\n");

// Query 1: Total signatures
db.get("SELECT COUNT(*) as total FROM signatures", (err, row) => {
    if (err) {
        console.error("Error:", err);
        return;
    }
    console.log(`📊 Total Immunity Signatures: ${row.total}`);
});

// Query 2: Breakdown by mitigation action
db.all("SELECT mitigation_action, COUNT(*) as count, AVG(threat_score) as avg_score FROM signatures GROUP BY mitigation_action", (err, rows) => {
    if (err) {
        console.error("Error:", err);
        return;
    }
    console.log("\n🛡️  Signatures by Mitigation Action:");
    rows.forEach(row => {
        console.log(`   - ${row.mitigation_action}: ${row.count} signatures (avg score: ${row.avg_score.toFixed(2)})`);
    });
});

// Query 3: Sample signatures
db.all("SELECT pattern_text, threat_score, mitigation_action, created_at FROM signatures ORDER BY created_at DESC LIMIT 10", (err, rows) => {
    if (err) {
        console.error("Error:", err);
        return;
    }
    console.log("\n📋 Recent Signatures (Latest 10):");
    rows.forEach((row, i) => {
        const truncated = row.pattern_text.length > 60 ? row.pattern_text.substring(0, 60) + "..." : row.pattern_text;
        console.log(`   ${i + 1}. [${row.threat_score}] ${truncated}`);
    });
});

// Query 4: Attack type distribution (SQL vs Prompt)
db.all("SELECT CASE WHEN pattern_text LIKE '%SELECT%' OR pattern_text LIKE '%DROP%' OR pattern_text LIKE '%UNION%' OR pattern_text LIKE '%DELETE%' OR pattern_text LIKE '%UPDATE%' OR pattern_text LIKE '%INSERT%' THEN 'SQL_INJECTION' ELSE 'PROMPT_INJECTION' END as attack_type, COUNT(*) as count FROM signatures GROUP BY attack_type", (err, rows) => {
    if (err) {
        console.error("Error:", err);
        db.close();
        return;
    }
    console.log("\n🎯 Attack Type Distribution:");
    rows.forEach(row => {
        console.log(`   - ${row.attack_type}: ${row.count} signatures`);
    });

    console.log("\n" + "=".repeat(60));
    console.log("✅ Database query complete!\n");
    db.close();
});
