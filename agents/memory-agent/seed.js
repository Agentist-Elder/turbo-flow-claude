const axios = require('axios');
const { addMemory } = require('./db');

const initialFacts = [
    "The sky is usually blue during the day due to Rayleigh scattering.",
    "Apples are typically red or green fruits and are rich in fiber.",
    "Rust is a high-performance systems programming language that guarantees memory safety.",
    "Dogs are loyal animals often kept as pets and used for guarding.",
    "Python is great for data science but can be slower than compiled languages like Rust.",
    "Docker containers package code and dependencies together for consistent deployment."
];

async function seed() {
    console.log("🌱 Seeding Database...");

    for (const text of initialFacts) {
        try {
            // 1. Get Vector from Rust Engine
            const res = await axios.post('http://127.0.0.1:3000', { text });
            const vector = res.data.sample;

            // 2. Save to SQLite
            await addMemory(text, vector);
            console.log(`✅ Saved: "${text.substring(0, 30)}..."`);
        } catch (e) {
            console.error(`❌ Failed: ${text}`, e.message);
        }
    }
    console.log("🎉 Database seeded successfully!");
}

seed();
