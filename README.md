# Apple Reminders MCP Server

An [MCP (Model Context Protocol)](https://modelcontextprotocol.io/) server that provides CRUD operations for **Apple Reminders** via AppleScript.

**No Full Disk Access required** — only the Automation permission is needed.

## Features

- **List reminder lists** — discover all available lists/folders
- **Get reminders** — filter by list, completion status, with configurable limit
- **Create reminders** — with optional list, due date, priority, and notes
- **Complete reminders** — mark reminders as done
- **Update reminders** — change name, notes, due date, or priority
- **Delete reminders** — permanently remove individual reminders
- **Create/delete lists** — manage reminder lists

## Requirements

- macOS (Apple Reminders app)
- Node.js >= 18
- **Automation permission**: System Settings > Privacy & Security > Automation — allow the host app (Terminal, Claude Desktop, etc.) to control Reminders

## Installation

```bash
git clone https://github.com/pesip/apple-reminders-mcp-server.git
cd apple-reminders-mcp-server
npm install
npm run build
```

## Usage with Claude Desktop

Add to your Claude Desktop MCP config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "apple-reminders": {
      "command": "node",
      "args": ["/path/to/apple-reminders-mcp-server/dist/index.js"]
    }
  }
}
```

## Usage with Claude Code

Add to your Claude Code MCP settings:

```bash
claude mcp add apple-reminders node /path/to/apple-reminders-mcp-server/dist/index.js
```

## Available Tools

| Tool | Description |
|------|-------------|
| `reminders_list_lists` | List all reminder lists |
| `reminders_get_reminders` | Get reminders with optional filters |
| `reminders_create_reminder` | Create a new reminder |
| `reminders_complete_reminder` | Mark a reminder as completed |
| `reminders_update_reminder` | Update reminder properties |
| `reminders_delete_reminder` | Delete a reminder |
| `reminders_create_list` | Create a new reminder list |
| `reminders_delete_list` | Delete a reminder list and all its reminders |

## Development

```bash
npm run dev    # Watch mode with tsx
npm run build  # Compile TypeScript
npm start      # Run compiled server
```

## License

MIT
