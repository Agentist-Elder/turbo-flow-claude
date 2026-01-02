const path = require('path');

// Load the binary
let binding;
try {
    binding = require('./aimds-rust.linux-x64-gnu.node');
} catch (e) {
    try {
        binding = require('./aimds-rust.node');
    } catch (e2) {
        throw new Error("Could not find aimds-rust binary");
    }
}

// Wrap the Class to inject the model path automatically
const NativeEngine = binding.VectorEngine;

class VectorEngine extends NativeEngine {
    constructor() {
        // Automatically point to the local 'model' folder in this directory
        const modelPath = path.join(__dirname, 'model');
        super(modelPath);
    }
}

module.exports = { VectorEngine };
