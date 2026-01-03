use wasm_bindgen::prelude::*;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;

/// Represents a memory entry with text content and its vector embedding
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Memory {
    pub id: String,
    pub text: String,
    pub vector: Vec<f64>,
    pub metadata: HashMap<String, String>,
    pub timestamp: f64,
}

/// Result of a similarity search
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SearchResult {
    pub id: String,
    pub text: String,
    pub similarity: f64,
    pub metadata: HashMap<String, String>,
}

/// Core AgentDB implementation with vector storage and cosine similarity search
#[wasm_bindgen]
pub struct AgentDB {
    memories: Vec<Memory>,
}

#[wasm_bindgen]
impl AgentDB {
    /// Creates a new AgentDB instance
    #[wasm_bindgen(constructor)]
    pub fn new() -> AgentDB {
        AgentDB {
            memories: Vec::new(),
        }
    }

    /// Adds a memory to the database
    ///
    /// # Arguments
    /// * `id` - Unique identifier for the memory
    /// * `text` - Text content of the memory
    /// * `vector` - Vector embedding as JSON array
    /// * `metadata` - Optional metadata as JSON object
    /// * `timestamp` - Unix timestamp in milliseconds
    ///
    /// # Returns
    /// Result<(), JsValue> - Ok on success, Err with error message on failure
    #[wasm_bindgen]
    pub fn add(
        &mut self,
        id: String,
        text: String,
        vector: JsValue,
        metadata: JsValue,
        timestamp: f64,
    ) -> Result<(), JsValue> {
        // Deserialize vector from JavaScript
        let vector: Vec<f64> = serde_wasm_bindgen::from_value(vector)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse vector: {}", e)))?;

        // Validate vector is not empty
        if vector.is_empty() {
            return Err(JsValue::from_str("Vector cannot be empty"));
        }

        // Deserialize metadata from JavaScript (or use empty map if null/undefined)
        let metadata: HashMap<String, String> = if metadata.is_null() || metadata.is_undefined() {
            HashMap::new()
        } else {
            serde_wasm_bindgen::from_value(metadata)
                .map_err(|e| JsValue::from_str(&format!("Failed to parse metadata: {}", e)))?
        };

        // Create and store the memory
        let memory = Memory {
            id: id.clone(),
            text,
            vector,
            metadata,
            timestamp,
        };

        // Check if memory with this ID already exists and update it, otherwise add new
        if let Some(pos) = self.memories.iter().position(|m| m.id == id) {
            self.memories[pos] = memory;
        } else {
            self.memories.push(memory);
        }

        Ok(())
    }

    /// Searches for similar memories using cosine similarity
    ///
    /// # Arguments
    /// * `query_vector` - Query vector as JSON array
    /// * `top_k` - Number of top results to return
    /// * `threshold` - Minimum similarity threshold (0.0 to 1.0)
    ///
    /// # Returns
    /// JsValue - JSON array of SearchResult objects sorted by similarity (highest first)
    #[wasm_bindgen]
    pub fn search(
        &self,
        query_vector: JsValue,
        top_k: usize,
        threshold: f64,
    ) -> Result<JsValue, JsValue> {
        // Deserialize query vector
        let query_vector: Vec<f64> = serde_wasm_bindgen::from_value(query_vector)
            .map_err(|e| JsValue::from_str(&format!("Failed to parse query vector: {}", e)))?;

        // Validate query vector is not empty
        if query_vector.is_empty() {
            return Err(JsValue::from_str("Query vector cannot be empty"));
        }

        // Validate threshold is in valid range
        if threshold < 0.0 || threshold > 1.0 {
            return Err(JsValue::from_str("Threshold must be between 0.0 and 1.0"));
        }

        // Calculate similarities for all memories
        let mut results: Vec<SearchResult> = self
            .memories
            .iter()
            .filter_map(|memory| {
                match cosine_similarity(&query_vector, &memory.vector) {
                    Ok(similarity) => {
                        // Only include results above threshold
                        if similarity >= threshold {
                            Some(SearchResult {
                                id: memory.id.clone(),
                                text: memory.text.clone(),
                                similarity,
                                metadata: memory.metadata.clone(),
                            })
                        } else {
                            None
                        }
                    }
                    Err(_) => None, // Skip memories with incompatible vector dimensions
                }
            })
            .collect();

        // Sort by similarity (highest first)
        results.sort_by(|a, b| {
            b.similarity
                .partial_cmp(&a.similarity)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        // Take top K results
        results.truncate(top_k);

        // Serialize to JavaScript
        serde_wasm_bindgen::to_value(&results)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize results: {}", e)))
    }

    /// Returns the total number of memories in the database
    #[wasm_bindgen]
    pub fn size(&self) -> usize {
        self.memories.len()
    }

    /// Clears all memories from the database
    #[wasm_bindgen]
    pub fn clear(&mut self) {
        self.memories.clear();
    }

    /// Removes a memory by ID
    ///
    /// # Arguments
    /// * `id` - ID of the memory to remove
    ///
    /// # Returns
    /// bool - true if memory was found and removed, false otherwise
    #[wasm_bindgen]
    pub fn remove(&mut self, id: String) -> bool {
        if let Some(pos) = self.memories.iter().position(|m| m.id == id) {
            self.memories.remove(pos);
            true
        } else {
            false
        }
    }

    /// Gets a memory by ID
    ///
    /// # Arguments
    /// * `id` - ID of the memory to retrieve
    ///
    /// # Returns
    /// JsValue - Memory object or null if not found
    #[wasm_bindgen]
    pub fn get(&self, id: String) -> Result<JsValue, JsValue> {
        if let Some(memory) = self.memories.iter().find(|m| m.id == id) {
            serde_wasm_bindgen::to_value(memory)
                .map_err(|e| JsValue::from_str(&format!("Failed to serialize memory: {}", e)))
        } else {
            Ok(JsValue::NULL)
        }
    }

    /// Exports all memories as JSON
    #[wasm_bindgen]
    pub fn export_all(&self) -> Result<JsValue, JsValue> {
        serde_wasm_bindgen::to_value(&self.memories)
            .map_err(|e| JsValue::from_str(&format!("Failed to serialize memories: {}", e)))
    }
}

/// Calculates cosine similarity between two vectors
///
/// Cosine similarity formula:
/// similarity = (A · B) / (||A|| * ||B||)
///
/// Where:
/// - A · B is the dot product of vectors A and B
/// - ||A|| is the magnitude (L2 norm) of vector A
/// - ||B|| is the magnitude (L2 norm) of vector B
///
/// Returns a value between -1 and 1, where:
/// - 1 means vectors are identical in direction
/// - 0 means vectors are orthogonal (perpendicular)
/// - -1 means vectors are opposite in direction
///
/// # Arguments
/// * `a` - First vector
/// * `b` - Second vector
///
/// # Returns
/// Result<f64, String> - Similarity score or error if vectors have different dimensions
pub fn cosine_similarity(a: &[f64], b: &[f64]) -> Result<f64, String> {
    // Validate vectors have same dimension
    if a.len() != b.len() {
        return Err(format!(
            "Vector dimensions must match: {} vs {}",
            a.len(),
            b.len()
        ));
    }

    // Handle empty vectors
    if a.is_empty() {
        return Err("Vectors cannot be empty".to_string());
    }

    // Calculate dot product: sum of element-wise multiplication
    let dot_product: f64 = a.iter().zip(b.iter()).map(|(ai, bi)| ai * bi).sum();

    // Calculate magnitude of vector a: sqrt(sum of squares)
    let magnitude_a: f64 = a.iter().map(|ai| ai * ai).sum::<f64>().sqrt();

    // Calculate magnitude of vector b: sqrt(sum of squares)
    let magnitude_b: f64 = b.iter().map(|bi| bi * bi).sum::<f64>().sqrt();

    // Handle zero magnitude (would cause division by zero)
    if magnitude_a == 0.0 || magnitude_b == 0.0 {
        return Ok(0.0); // Vectors with zero magnitude have zero similarity
    }

    // Calculate cosine similarity
    let similarity = dot_product / (magnitude_a * magnitude_b);

    Ok(similarity)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_cosine_similarity_identical_vectors() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![1.0, 2.0, 3.0];
        let similarity = cosine_similarity(&a, &b).unwrap();
        assert!((similarity - 1.0).abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_orthogonal_vectors() {
        let a = vec![1.0, 0.0];
        let b = vec![0.0, 1.0];
        let similarity = cosine_similarity(&a, &b).unwrap();
        assert!((similarity - 0.0).abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_opposite_vectors() {
        let a = vec![1.0, 2.0, 3.0];
        let b = vec![-1.0, -2.0, -3.0];
        let similarity = cosine_similarity(&a, &b).unwrap();
        assert!((similarity - (-1.0)).abs() < 1e-10);
    }

    #[test]
    fn test_cosine_similarity_different_dimensions() {
        let a = vec![1.0, 2.0];
        let b = vec![1.0, 2.0, 3.0];
        assert!(cosine_similarity(&a, &b).is_err());
    }

    #[test]
    fn test_cosine_similarity_zero_vector() {
        let a = vec![0.0, 0.0, 0.0];
        let b = vec![1.0, 2.0, 3.0];
        let similarity = cosine_similarity(&a, &b).unwrap();
        assert_eq!(similarity, 0.0);
    }

    #[test]
    fn test_agentdb_add_and_size() {
        let mut db = AgentDB::new();
        assert_eq!(db.size(), 0);

        // Note: In actual WASM context, we'd use JsValue
        // These tests are for the Rust implementation logic
    }

    #[test]
    fn test_agentdb_clear() {
        let mut db = AgentDB::new();
        db.clear();
        assert_eq!(db.size(), 0);
    }
}
