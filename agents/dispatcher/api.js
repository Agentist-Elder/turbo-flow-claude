const tools = require('./search_tools');

async function handle(task, input) {
    try {
        if (task === 'SEARCH') {
            return await tools.searchWeb(input);
        }
        return "Unknown Researcher Task";
    } catch (e) {
        return `Researcher Error: ${e.message}`;
    }
}

module.exports = { handle };
