# opencode-openmemory

[![npm version](https://badge.fury.io/js/@happycastle/opencode-openmemory.svg)](https://www.npmjs.com/package/@happycastle/opencode-openmemory)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

**Local-first, privacy-focused persistent memory for OpenCode agents** using [OpenMemory](https://github.com/CaviraOSS/OpenMemory).

A fork of [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory), redesigned to work with OpenMemory - an open-source, self-hosted cognitive memory engine that keeps your data on your machine.

## Features

- **Local-first**: All memories stored on your machine via OpenMemory
- **Privacy-focused**: No data sent to external services
- **Automatic context injection**: User profile, project memory, and relevant memories injected into conversations
- **Explicit & implicit memory capture**: Save memories with "remember this" or let the agent extract knowledge automatically
- **Scope separation**: User-level (cross-project) vs project-level memories
- **Context compaction**: Smart summarization when context window fills up

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                   OpenCode (Plugin)                           │
│  - Injection Policy (format, token budget, priority)          │
│  - Memory Capture Policy (explicit "remember", implicit)      │
│  - Scope Router (user_id, project_id)                         │
└───────────────────┬───────────────────────────────────────────┘
                    │
                    v
┌───────────────────────────────────────────────────────────────┐
│                 OpenMemory Server (REST API)                   │
│  - Store: raw notes / facts / events / snippets                │
│  - Index: embeddings + metadata (scope/recency/type)           │
│  - Retrieval: hybrid scoring (similarity + salience + decay)   │
│  - Default: http://localhost:8080                              │
└───────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Install the plugin

```bash
bunx @eddy.soungmin/opencode-openmemory@latest install
```

Or manually add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["@happycastle/opencode-openmemory@latest"]
}
```

### 2. Start OpenMemory

**Option A: Docker (recommended)**

```bash
git clone https://github.com/CaviraOSS/OpenMemory.git
cd OpenMemory
cp .env.example .env
# Edit .env with your OPENAI_API_KEY (for embeddings)
docker compose up --build -d
```

**Option B: Manual setup (for development)**

```bash
git clone https://github.com/CaviraOSS/OpenMemory.git
cd OpenMemory/backend
npm install
npm run dev   # Starts on :8080 by default
```

For more details, see the [OpenMemory documentation](https://github.com/CaviraOSS/OpenMemory).

### 3. Restart OpenCode

The plugin will automatically connect to OpenMemory REST API at `http://localhost:8080`.

## Configuration

Create `~/.config/opencode/openmemory.jsonc`:

```jsonc
{
  // OpenMemory REST API URL
  "apiUrl": "http://localhost:8080",
  
  // Search settings
  "similarityThreshold": 0.6,
  "maxMemories": 5,
  "maxProjectMemories": 10,
  "maxProfileItems": 5,
  "minSalience": 0.3,
  
  // Context injection
  "injectProfile": true,
  
  // Scope prefix for organizing memories
  "scopePrefix": "opencode",
  
  // Default sector for storing memories
  "defaultSector": "semantic"
}
```

## Usage

### Automatic Context Injection

On the first message of each session, the plugin automatically injects:

1. **User Profile**: Cross-project preferences and patterns
2. **Project Knowledge**: Project-specific memories from the current directory
3. **Relevant Memories**: Semantically similar memories to the current query

### Explicit Memory Saving

Use trigger phrases to save memories:

```
"Remember that we use Prettier with single quotes"
"Save this: always run tests before committing"
"Keep in mind that the auth service is in /src/lib/auth"
```

### Tool Commands

The `openmemory` tool is available with these modes:

| Mode | Description | Arguments |
|------|-------------|-----------|
| `add` | Store a new memory | `content`, `type?`, `scope?` |
| `search` | Search memories | `query`, `scope?`, `limit?` |
| `profile` | View user profile | `query?` |
| `list` | List recent memories | `scope?`, `limit?` |
| `forget` | Remove a memory | `memoryId`, `scope?` |
| `help` | Show usage guide | - |

**Scopes:**
- `user`: Cross-project preferences and knowledge
- `project`: Project-specific knowledge (default)

**Memory Types:**
- `project-config`: Tech stack, commands, tooling
- `architecture`: Codebase structure, components, data flow
- `learned-pattern`: Conventions specific to this codebase
- `error-solution`: Known issues and their fixes
- `preference`: Coding style preferences
- `conversation`: Session summaries

### Initialize Memory

Run the `/openmemory-init` command to deeply research your codebase and populate memory:

```
/openmemory-init
```

## Context Compaction

When the context window fills up (80% by default), the plugin:

1. Injects project knowledge into the summary prompt
2. Triggers OpenCode's summarization
3. Saves the summary as a memory for future sessions
4. Automatically resumes the conversation

## Usage with Oh My OpenCode

If you're using [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode), disable its built-in auto-compact hook to let this plugin handle context compaction:

Add to `~/.config/opencode/oh-my-opencode.json`:

```json
{
  "disabled_hooks": ["anthropic-context-window-limit-recovery"]
}
```

## Development

```bash
# Clone
git clone https://github.com/happycastle114/opencode-openmemory.git
cd opencode-openmemory

# Install dependencies
bun install

# Type check
bun run typecheck

# Build
bun run build

# Development (watch mode)
bun run dev

# Local testing with OpenCode
bun run build && opencode --plugin ./dist/index.js
```

## Comparison with opencode-supermemory

| Feature | opencode-supermemory | @eddy.soungmin/opencode-openmemory |
|---------|---------------------|-------------------------------------|
| Backend | Supermemory Cloud | OpenMemory (local) |
| Data Location | Cloud | Your machine |
| Privacy | Requires API key | Fully local |
| Cost | API usage fees | Free (self-hosted) |

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add some amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Credits

- Based on [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory) by Supermemory
- Uses [OpenMemory](https://github.com/CaviraOSS/OpenMemory) by CaviraOSS
- Developed by [@happycastle114](https://github.com/happycastle114)

## Special Thanks

- [Oh My OpenCode](https://github.com/code-yeongyu/oh-my-opencode) - This plugin was developed using Oh My OpenCode's powerful agent orchestration capabilities
