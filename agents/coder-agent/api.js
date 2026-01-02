const tools = require('./fs_tools');

async function handle(task, input) {
    try {
        if (task === 'LIST') return await tools.listFiles(input);
        if (task === 'READ') return await tools.readFile(input);
        if (task === 'WRITE') return await tools.writeFile(input.path, input.content);
        return "Unknown Coder Task";
    } catch (e) {
        return `Coder Error: ${e.message}`;
    }
}

module.exports = { handle };
