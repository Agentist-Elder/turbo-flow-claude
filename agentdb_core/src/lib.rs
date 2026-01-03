use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

#[wasm_bindgen]
extern "C" {
    #[wasm_bindgen(js_namespace = console)]
    fn log(s: &str);
}

macro_rules! console_log {
    ($($t:tt)*) => (log(&format_args!($($t)*).to_string()))
}

#[derive(Serialize, Deserialize, Clone)]
pub struct MemoryRecord {
    pub id: usize,
    pub text: String,
    pub vector: Vec<f32>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Clone)]
pub struct SignatureRecord {
    pub id: usize,
    pub pattern_text: String,
    pub vector: Vec<f32>,
    pub threat_score: f32,
    pub mitigation_action: String,
    pub encounter_count: u32,
}

#[wasm_bindgen]
pub struct AgentDB {
    memories: HashMap<usize, MemoryRecord>,
    signatures: HashMap<usize, SignatureRecord>,
    next_memory_id: usize,
    next_signature_id: usize,
}

#[wasm_bindgen]
impl AgentDB {
    #[wasm_bindgen(constructor)]
    pub fn new() -> AgentDB {
        console_log!("[WASM AgentDB] Initializing vector database in Rust/WASM");
        AgentDB {
            memories: HashMap::new(),
            signatures: HashMap::new(),
            next_memory_id: 1,
            next_signature_id: 1,
        }
    }

    /// Add a memory record with text and embedding vector
    #[wasm_bindgen]
    pub fn add_memory(&mut self, text: String, vector: Vec<f32>) -> usize {
        let id = self.next_memory_id;
        self.next_memory_id += 1;

        let record = MemoryRecord {
            id,
            text,
            vector,
            created_at: js_sys::Date::new_0().to_iso_string().as_string().unwrap(),
        };

        self.memories.insert(id, record);
        console_log!("[WASM AgentDB] Added memory #{}", id);
        id
    }

    /// Add a threat signature with pattern, vector, score, and action
    #[wasm_bindgen]
    pub fn add_signature(
        &mut self,
        pattern_text: String,
        vector: Vec<f32>,
        threat_score: f32,
        mitigation_action: String,
    ) -> usize {
        // Check if pattern already exists, increment counter if found
        for (id, sig) in self.signatures.iter_mut() {
            if sig.pattern_text == pattern_text {
                sig.encounter_count += 1;
                sig.vector = vector;
                console_log!(
                    "[WASM AgentDB] Updated signature #{} (encounters: {})",
                    id,
                    sig.encounter_count
                );
                return *id;
            }
        }

        // Create new signature
        let id = self.next_signature_id;
        self.next_signature_id += 1;

        let record = SignatureRecord {
            id,
            pattern_text,
            vector,
            threat_score,
            mitigation_action,
            encounter_count: 1,
        };

        self.signatures.insert(id, record);
        console_log!("[WASM AgentDB] Added signature #{}", id);
        id
    }

    /// Calculate cosine similarity between two vectors (in Rust!)
    /// Returns value between 0.0 and 1.0
    #[wasm_bindgen]
    pub fn cosine_similarity(vec_a: Vec<f32>, vec_b: Vec<f32>) -> f32 {
        if vec_a.len() != vec_b.len() {
            console_log!(
                "[WASM AgentDB] ERROR: Vector dimension mismatch: {} vs {}",
                vec_a.len(),
                vec_b.len()
            );
            return 0.0;
        }

        let mut dot_product = 0.0_f32;
        let mut norm_a = 0.0_f32;
        let mut norm_b = 0.0_f32;

        for i in 0..vec_a.len() {
            dot_product += vec_a[i] * vec_b[i];
            norm_a += vec_a[i] * vec_a[i];
            norm_b += vec_b[i] * vec_b[i];
        }

        norm_a = norm_a.sqrt();
        norm_b = norm_b.sqrt();

        if norm_a == 0.0 || norm_b == 0.0 {
            return 0.0;
        }

        dot_product / (norm_a * norm_b)
    }

    /// Search for similar memories using cosine similarity
    /// Returns top N results as JSON string
    #[wasm_bindgen]
    pub fn search_memories(&self, query_vector: Vec<f32>, top_n: usize) -> String {
        console_log!(
            "[WASM AgentDB] Searching {} memories with {}-dimensional vector",
            self.memories.len(),
            query_vector.len()
        );

        let mut scored: Vec<(usize, f32, String)> = self
            .memories
            .iter()
            .map(|(id, record)| {
                let similarity = Self::cosine_similarity(query_vector.clone(), record.vector.clone());
                (*id, similarity, record.text.clone())
            })
            .collect();

        // Sort by similarity (descending)
        scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());

        let results: Vec<_> = scored
            .iter()
            .take(top_n)
            .map(|(id, score, text)| {
                serde_json::json!({
                    "id": id,
                    "score": score,
                    "text": text
                })
            })
            .collect();

        serde_json::to_string(&results).unwrap()
    }

    /// Check immunity - find matching threat signature
    /// Returns signature as JSON string if similarity > threshold (0.65)
    #[wasm_bindgen]
    pub fn check_immunity(&self, input_vector: Vec<f32>) -> Option<String> {
        console_log!(
            "[WASM AgentDB] Checking immunity against {} signatures",
            self.signatures.len()
        );

        let threshold = 0.65;
        let mut best_match: Option<(&SignatureRecord, f32)> = None;

        for signature in self.signatures.values() {
            let similarity = Self::cosine_similarity(input_vector.clone(), signature.vector.clone());

            if similarity > threshold {
                if let Some((_, best_score)) = best_match {
                    if similarity > best_score {
                        best_match = Some((signature, similarity));
                    }
                } else {
                    best_match = Some((signature, similarity));
                }
            }
        }

        if let Some((sig, score)) = best_match {
            console_log!(
                "[WASM AgentDB] THREAT DETECTED! Signature #{} (similarity: {:.3})",
                sig.id,
                score
            );

            let result = serde_json::json!({
                "id": sig.id,
                "pattern_text": sig.pattern_text,
                "threat_score": sig.threat_score,
                "mitigation_action": sig.mitigation_action,
                "encounter_count": sig.encounter_count,
                "similarity": score
            });

            Some(serde_json::to_string(&result).unwrap())
        } else {
            console_log!("[WASM AgentDB] No immunity match found (clean input)");
            None
        }
    }

    /// Get total memory count
    #[wasm_bindgen]
    pub fn memory_count(&self) -> usize {
        self.memories.len()
    }

    /// Get total signature count
    #[wasm_bindgen]
    pub fn signature_count(&self) -> usize {
        self.signatures.len()
    }

    /// Get database stats as JSON string
    #[wasm_bindgen]
    pub fn get_stats(&self) -> String {
        let stats = serde_json::json!({
            "memories": self.memories.len(),
            "signatures": self.signatures.len(),
            "next_memory_id": self.next_memory_id,
            "next_signature_id": self.next_signature_id
        });
        serde_json::to_string(&stats).unwrap()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity() {
        let vec_a = vec![1.0, 0.0, 0.0];
        let vec_b = vec![1.0, 0.0, 0.0];
        assert_eq!(AgentDB::cosine_similarity(vec_a, vec_b), 1.0);

        let vec_a = vec![1.0, 0.0, 0.0];
        let vec_b = vec![0.0, 1.0, 0.0];
        assert_eq!(AgentDB::cosine_similarity(vec_a, vec_b), 0.0);
    }

    #[test]
    fn test_add_memory() {
        let mut db = AgentDB::new();
        let id = db.add_memory("test".to_string(), vec![1.0, 2.0, 3.0]);
        assert_eq!(id, 1);
        assert_eq!(db.memory_count(), 1);
    }

    #[test]
    fn test_add_signature() {
        let mut db = AgentDB::new();
        let id = db.add_signature(
            "malicious pattern".to_string(),
            vec![1.0, 2.0, 3.0],
            0.9,
            "BLOCK".to_string(),
        );
        assert_eq!(id, 1);
        assert_eq!(db.signature_count(), 1);
    }
}
