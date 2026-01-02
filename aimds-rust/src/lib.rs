use napi::bindgen_prelude::*;
use napi_derive::napi;
use candle_core::{Tensor, Device, DType, Module};
use candle_transformers::models::bert::{BertModel, Config};
use tokenizers::Tokenizer;
use std::path::Path;

#[napi]
pub struct VectorEngine {
    model: BertModel,
    tokenizer: Tokenizer,
}

#[napi]
impl VectorEngine {
    #[napi(constructor)]
    pub fn new(model_path: String) -> Result<Self> {
        let config_path = format!("{}/config.json", model_path);
        let tokenizer_path = format!("{}/tokenizer.json", model_path);
        let weights_path = format!("{}/model.safetensors", model_path);

        if !Path::new(&config_path).exists() {
            return Err(Error::from_reason(format!("Missing config at: {}", config_path)));
        }

        let config: Config = serde_json::from_str(&std::fs::read_to_string(config_path).map_err(|e| Error::from_reason(e.to_string()))?).map_err(|e| Error::from_reason(e.to_string()))?;
        let tokenizer = Tokenizer::from_file(tokenizer_path).map_err(|e| Error::from_reason(e.to_string()))?;
        
        let vb = unsafe { candle_nn::VarBuilder::from_mmaped_safetensors(&[weights_path], DType::F32, &Device::Cpu) }
            .map_err(|e| Error::from_reason(e.to_string()))?;
        
        let model = BertModel::load(vb, &config).map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(VectorEngine { model, tokenizer })
    }

    #[napi]
    pub fn get_vector(&self, text: String) -> Result<Vec<f64>> {
        let tokens = self.tokenizer.encode(text, true).map_err(|e| Error::from_reason(e.to_string()))?;
        let token_ids = Tensor::new(tokens.get_ids(), &Device::Cpu)
            .map_err(|e| Error::from_reason(e.to_string()))?
            .unsqueeze(0)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        
        let token_type_ids = token_ids.zeros_like().map_err(|e| Error::from_reason(e.to_string()))?;

        let embeddings = self.model.forward(&token_ids, &token_type_ids)
            .map_err(|e| Error::from_reason(e.to_string()))?;
        
        let (_n_sentence, n_tokens, _hidden_size) = embeddings.dims3().map_err(|e| Error::from_reason(e.to_string()))?;
        
        let pooled = (embeddings.sum(1).map_err(|e| Error::from_reason(e.to_string()))? / (n_tokens as f64)).map_err(|e| Error::from_reason(e.to_string()))?;
        
        // The Fix: Convert F32 -> F64 before returning
        let final_vec = pooled
            .to_dtype(DType::F64).map_err(|e| Error::from_reason(e.to_string()))?
            .flatten_all().map_err(|e| Error::from_reason(e.to_string()))?
            .to_vec1::<f64>().map_err(|e| Error::from_reason(e.to_string()))?;

        Ok(final_vec)
    }
}
