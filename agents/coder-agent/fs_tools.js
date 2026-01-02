const fs = require('fs').promises;
const path = require('path');

// Security: Only allow editing inside the workspace
const WORKSPACE_ROOT = path.resolve(__dirname, '../../'); 

async function listFiles(dirPath = '') {
    try {
        const fullPath = path.join(WORKSPACE_ROOT, dirPath);
        const files = await fs.readdir(fullPath, { withFileTypes: true });
        return files.map(f => (f.isDirectory() ? `[DIR] ${f.name}` : f.name));
    } catch (e) {
        return `Error listing files: ${e.message}`;
    }
}

async function readFile(filePath) {
    try {
        const fullPath = path.join(WORKSPACE_ROOT, filePath);
        return await fs.readFile(fullPath, 'utf8');
    } catch (e) {
        return `Error reading file: ${e.message}`;
    }
}

async function writeFile(filePath, content) {
    try {
        const fullPath = path.join(WORKSPACE_ROOT, filePath);
        await fs.writeFile(fullPath, content, 'utf8');
        return `Successfully wrote to ${filePath}`;
    } catch (e) {
        return `Error writing file: ${e.message}`;
    }
}

module.exports = { listFiles, readFile, writeFile };
