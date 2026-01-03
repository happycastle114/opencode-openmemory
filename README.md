# opencode-openmemory

**Local-first, privacy-focused persistent memory for OpenCode agents** using [OpenMemory](https://github.com/mem0ai/mem0/tree/main/openmemory).

A fork of [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory), redesigned to work with OpenMemory - an open-source, self-hosted memory backend that keeps your data on your machine.

## Features

- **Local-first**: All memories stored on your machine via OpenMemory
- **Privacy-focused**: No data sent to external services
- **Automatic context injection**: User profile, project memory, and relevant memories injected into conversations
- **Explicit & implicit memory capture**: Save memories with "remember this" or let the agent extract knowledge automatically
- **Scope separation**: User-level (cross-project) vs project-level memories
- **HSG Memory Sectors**: Episodic, Semantic, Procedural, Emotional, Reflective
- **Adapter pattern**: Swap between MCP and REST backends easily
- **Context compaction**: Smart summarization when context window fills up

## Architecture

```
┌───────────────────────────────────────────────────────────────┐
│                   OpenCode (Plugin)                           │
│  - Injection Policy (format, token budget, priority)          │
│  - Memory Capture Policy (explicit "remember", implicit)      │
│  - Scope Router (user_id, project_id)                         │
│  - Adapter: MemoryBackendClient (MCP/REST)                    │
└───────────────────┬───────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        │                       │
        v                       v
┌───────────────┐       ┌───────────────┐
│  MCP Client   │       │  REST Client  │
│  (default)    │       │  (optional)   │
└───────┬───────┘       └───────┬───────┘
        │                       │
        └───────────┬───────────┘
                    v
┌───────────────────────────────────────────────────────────────┐
│                 OpenMemory Server                              │
│  - Store: raw notes / facts / events / snippets                │
│  - Index: embeddings + metadata (scope/recency/type)           │
│  - Retrieval: hybrid scoring (similarity + salience + decay)   │
│  - HSG: 5 memory sectors (episodic/semantic/procedural/...)    │
└───────────────────────────────────────────────────────────────┘
```

## Installation

### 1. Install the plugin

```bash
bunx opencode-openmemory@latest install
```

Or manually add to `~/.config/opencode/opencode.jsonc`:

```jsonc
{
  "plugin": ["opencode-openmemory@latest"]
}
```

### 2. Start OpenMemory

**Option A: Docker (recommended)**

```bash
curl -sL https://raw.githubusercontent.com/mem0ai/mem0/main/openmemory/run.sh | bash
```

**Option B: Manual setup**

```bash
git clone https://github.com/mem0ai/mem0.git
cd mem0/openmemory
cp api/.env.example api/.env
# Edit api/.env with your OPENAI_API_KEY
docker-compose up --build
```

### 3. Restart OpenCode

The plugin will automatically detect and use OpenMemory MCP tools.

## Configuration

Create `~/.config/opencode/openmemory.jsonc`:

```jsonc
{
  // Backend: "openmemory" (MCP) or "openmemory-rest" (REST API)
  "backend": "openmemory",
  
  // REST API settings (when using openmemory-rest backend)
  // "apiUrl": "http://localhost:8765",
  
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

1. **User Profile**: Cross-project preferences and patterns (high salience memories)
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
| `add` | Store a new memory | `content`, `type?`, `scope?`, `sector?` |
| `search` | Search memories | `query`, `scope?`, `sector?`, `limit?` |
| `profile` | View user profile | `query?` |
| `list` | List recent memories | `scope?`, `sector?`, `limit?` |
| `forget` | Remove a memory | `memoryId`, `scope?` |
| `reinforce` | Boost memory importance | `memoryId`, `boost?` |
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

**Memory Sectors (HSG):**
- `episodic`: Events, experiences, temporal sequences
- `semantic`: Facts, concepts, general knowledge (default)
- `procedural`: Skills, how-to knowledge, processes
- `emotional`: Feelings, sentiments, reactions
- `reflective`: Meta-cognition, insights, patterns

### Initialize Memory

Run the `/openmemory-init` command to deeply research your codebase and populate memory:

```
/openmemory-init
```

## OpenMemory MCP Tools

The plugin uses these OpenMemory MCP tools:

| Tool | Description |
|------|-------------|
| `openmemory_openmemory_query` | Semantic search with salience scoring |
| `openmemory_openmemory_store` | Store new memories with tags and metadata |
| `openmemory_openmemory_list` | List recent memories by sector |
| `openmemory_openmemory_get` | Fetch a specific memory by ID |
| `openmemory_openmemory_reinforce` | Boost memory salience |

## Context Compaction

When the context window fills up (80% by default), the plugin:

1. Injects project knowledge into the summary prompt
2. Triggers OpenCode's summarization
3. Saves the summary as a memory for future sessions
4. Automatically resumes the conversation

## Development

```bash
# Clone
git clone https://github.com/opencode-ai/opencode-openmemory.git
cd opencode-openmemory

# Install dependencies
bun install

# Type check
bun run typecheck

# Build
bun run build

# Development (watch mode)
bun run dev
```

## Comparison with opencode-supermemory

| Feature | opencode-supermemory | opencode-openmemory |
|---------|---------------------|---------------------|
| Backend | Supermemory Cloud | OpenMemory (local) |
| Data Location | Cloud | Your machine |
| Privacy | Requires API key | Fully local |
| Memory Model | Key-value | HSG (5 sectors) |
| Salience | No | Yes (decay + boost) |
| Cost | API usage fees | Free (self-hosted) |

## License

MIT

## Credits

- Based on [opencode-supermemory](https://github.com/supermemoryai/opencode-supermemory) by Supermemory
- Uses [OpenMemory](https://github.com/mem0ai/mem0/tree/main/openmemory) by Mem0.ai
