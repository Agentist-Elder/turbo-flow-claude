use anyhow::{Error as E, Result};
use candle_core::{Device, Tensor, DType};
use candle_nn::VarBuilder;
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::Tokenizer;

pub struct VectorEngine {
    model: BertModel,
    tokenizer: Tokenizer,
    device: Device,
}

impl VectorEngine {
    pub fn new() -> Result<Self> {
        let device = Device::Cpu;
        println!("Loading AI Model from local './model' folder...");

        // 1. Define Local Paths (No Internet Needed)
        let config_path = "model/config.json";
        let tokenizer_path = "model/tokenizer.json";
        let weights_path = "model/model.safetensors";

        // 2. Load the Components
        let config: Config = serde_json::from_str(&std::fs::read_to_string(config_path)?)?;
        let tokenizer = Tokenizer::from_file(tokenizer_path).map_err(E::msg)?;
        
        let vb = unsafe { VarBuilder::from_mmaped_safetensors(&[weights_path], DType::F32, &device)? };
        let model = BertModel::load(vb, &config)?;

        println!("AI Model Loaded Successfully.");
        Ok(Self { model, tokenizer, device })
    }

    pub fn embed(&self, text: &str) -> Result<Vec<f32>> {
        // 1. Tokenize
        let tokens = self.tokenizer.encode(text, true).map_err(E::msg)?;
        let token_ids = Tensor::new(tokens.get_ids(), &self.device)?.unsqueeze(0)?;
        let token_type_ids = token_ids.zeros_like()?;

        // 2. Inference
        let embeddings = self.model.forward(&token_ids, &token_type_ids)?;
        
        // 3. Mean Pooling
        let (_n_sentence, n_tokens, _hidden_size) = embeddings.dims3()?;
        let embeddings = (embeddings.sum(1)? / (n_tokens as f64))?;
        let embeddings = embeddings.flatten_all()?;
        
        Ok(embeddings.to_vec1()?)
    }
}
