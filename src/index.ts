import type { Plugin, PluginInput } from "@opencode-ai/plugin";
import type { Part } from "@opencode-ai/sdk";
import { tool } from "@opencode-ai/plugin";

import { openMemoryClient, OpenMemoryMCPClient, getMemoryClient } from "./services/client.js";
import { formatContextForPrompt } from "./services/context.js";
import { getScopes, getTags } from "./services/tags.js";
import { stripPrivateContent, isFullyPrivate } from "./services/privacy.js";
import { createCompactionHook, type CompactionContext } from "./services/compaction.js";

import { isConfigured, CONFIG } from "./config.js";
import { log } from "./services/logger.js";
import type { MemoryScopeType, MemoryType, MemorySector } from "./types/index.js";

const CODE_BLOCK_PATTERN = /```[\s\S]*?```/g;
const INLINE_CODE_PATTERN = /`[^`]+`/g;

const MEMORY_KEYWORD_PATTERN =
  /\b(remember|memorize|save\s+this|note\s+this|keep\s+in\s+mind|don'?t\s+forget|learn\s+this|store\s+this|record\s+this|make\s+a\s+note|take\s+note|jot\s+down|commit\s+to\s+memory|remember\s+that|never\s+forget|always\s+remember)\b/i;

const MEMORY_NUDGE_MESSAGE = `[MEMORY TRIGGER DETECTED]
The user wants you to remember something. You MUST use the \`openmemory\` tool with \`mode: "add"\` to save this information.

Extract the key information the user wants remembered and save it as a concise, searchable memory.
- Use \`scope: "project"\` for project-specific preferences (e.g., "run lint with tests")
- Use \`scope: "user"\` for cross-project preferences (e.g., "prefers concise responses")
- Choose an appropriate \`type\`: "preference", "project-config", "learned-pattern", etc.

DO NOT skip this step. The user explicitly asked you to remember.`;

function removeCodeBlocks(text: string): string {
  return text.replace(CODE_BLOCK_PATTERN, "").replace(INLINE_CODE_PATTERN, "");
}

function detectMemoryKeyword(text: string): boolean {
  const textWithoutCode = removeCodeBlocks(text);
  return MEMORY_KEYWORD_PATTERN.test(textWithoutCode);
}

export const OpenMemoryPlugin: Plugin = async (ctx: PluginInput) => {
  const { directory } = ctx;
  const scopes = getScopes(directory);
  const tags = getTags(directory);
  const injectedSessions = new Set<string>();
  log("Plugin init", { directory, scopes, configured: isConfigured() });

  if (!isConfigured()) {
    log("Plugin disabled - OpenMemory not configured");
  }

  // Set up MCP tool caller if using MCP client
  const memoryClient = getMemoryClient();
  if (memoryClient instanceof OpenMemoryMCPClient) {
    // The MCP client will use the tools exposed by OpenMemory MCP server
    // These are available in the OpenCode environment
    log("OpenMemory MCP client initialized");
  }

  const compactionHook = isConfigured() && ctx.client
    ? createCompactionHook(ctx as CompactionContext, tags, scopes)
    : null;

  return {
    "chat.message": async (input, output) => {
      if (!isConfigured()) return;

      const start = Date.now();

      try {
        const textParts = output.parts.filter(
          (p): p is Part & { type: "text"; text: string } => p.type === "text"
        );

        if (textParts.length === 0) {
          log("chat.message: no text parts found");
          return;
        }

        const userMessage = textParts.map((p) => p.text).join("\n");

        if (!userMessage.trim()) {
          log("chat.message: empty message, skipping");
          return;
        }

        log("chat.message: processing", {
          messagePreview: userMessage.slice(0, 100),
          partsCount: output.parts.length,
          textPartsCount: textParts.length,
        });

        if (detectMemoryKeyword(userMessage)) {
          log("chat.message: memory keyword detected");
          const nudgePart: Part = {
            id: `openmemory-nudge-${Date.now()}`,
            sessionID: input.sessionID,
            messageID: output.message.id,
            type: "text",
            text: MEMORY_NUDGE_MESSAGE,
            synthetic: true,
          };
          output.parts.push(nudgePart);
        }

        const isFirstMessage = !injectedSessions.has(input.sessionID);

        if (isFirstMessage) {
          injectedSessions.add(input.sessionID);

          const [profileResult, userMemoriesResult, projectMemoriesListResult] = await Promise.all([
            openMemoryClient.getProfile(scopes.user, userMessage),
            openMemoryClient.searchMemories(userMessage, scopes.user, { limit: CONFIG.maxMemories }),
            openMemoryClient.listMemories(scopes.project, { limit: CONFIG.maxProjectMemories }),
          ]);

          const profile = profileResult.success ? profileResult : null;
          const userMemories = userMemoriesResult.success ? userMemoriesResult : { results: [] };
          const projectMemoriesList = projectMemoriesListResult.success ? projectMemoriesListResult : { memories: [] };

          const projectMemories = {
            results: (projectMemoriesList.memories || []).map((m) => ({
              id: m.id,
              content: m.content,
              score: m.salience || 1,
              salience: m.salience,
              sector: m.sector,
              tags: m.tags,
              metadata: m.metadata,
            })),
            total: projectMemoriesList.memories?.length || 0,
          };

          const memoryContext = formatContextForPrompt(
            profile,
            userMemories,
            projectMemories
          );

          if (memoryContext) {
            const contextPart: Part = {
              id: `openmemory-context-${Date.now()}`,
              sessionID: input.sessionID,
              messageID: output.message.id,
              type: "text",
              text: memoryContext,
              synthetic: true,
            };

            output.parts.unshift(contextPart);

            const duration = Date.now() - start;
            log("chat.message: context injected", {
              duration,
              contextLength: memoryContext.length,
            });
          }
        }

      } catch (error) {
        log("chat.message: ERROR", { error: String(error) });
      }
    },

    tool: {
      openmemory: tool({
        description:
          "Manage and query the OpenMemory persistent memory system. Use 'search' to find relevant memories, 'add' to store new knowledge, 'profile' to view user profile, 'list' to see recent memories, 'forget' to remove a memory, 'reinforce' to boost memory importance.",
        args: {
          mode: tool.schema
            .enum(["add", "search", "profile", "list", "forget", "reinforce", "help"])
            .optional(),
          content: tool.schema.string().optional(),
          query: tool.schema.string().optional(),
          type: tool.schema
            .enum([
              "project-config",
              "architecture",
              "error-solution",
              "preference",
              "learned-pattern",
              "conversation",
            ])
            .optional(),
          scope: tool.schema.enum(["user", "project"]).optional(),
          sector: tool.schema
            .enum(["episodic", "semantic", "procedural", "emotional", "reflective"])
            .optional(),
          memoryId: tool.schema.string().optional(),
          limit: tool.schema.number().optional(),
          boost: tool.schema.number().optional(),
        },
        async execute(args: {
          mode?: string;
          content?: string;
          query?: string;
          type?: MemoryType;
          scope?: "user" | "project";
          sector?: MemorySector;
          memoryId?: string;
          limit?: number;
          boost?: number;
        }) {
          if (!isConfigured()) {
            return JSON.stringify({
              success: false,
              error:
                "OpenMemory not configured. Ensure OpenMemory MCP server is running or configure REST API.",
            });
          }

          const mode = args.mode || "help";

          try {
            switch (mode) {
              case "help": {
                return JSON.stringify({
                  success: true,
                  message: "OpenMemory Usage Guide",
                  commands: [
                    {
                      command: "add",
                      description: "Store a new memory",
                      args: ["content", "type?", "scope?", "sector?"],
                    },
                    {
                      command: "search",
                      description: "Search memories",
                      args: ["query", "scope?", "sector?", "limit?"],
                    },
                    {
                      command: "profile",
                      description: "View user profile",
                      args: ["query?"],
                    },
                    {
                      command: "list",
                      description: "List recent memories",
                      args: ["scope?", "sector?", "limit?"],
                    },
                    {
                      command: "forget",
                      description: "Remove a memory",
                      args: ["memoryId", "scope?"],
                    },
                    {
                      command: "reinforce",
                      description: "Boost memory importance",
                      args: ["memoryId", "boost?"],
                    },
                  ],
                  scopes: {
                    user: "Cross-project preferences and knowledge",
                    project: "Project-specific knowledge (default)",
                  },
                  sectors: {
                    episodic: "Events, experiences, temporal sequences",
                    semantic: "Facts, concepts, general knowledge (default)",
                    procedural: "Skills, how-to knowledge, processes",
                    emotional: "Feelings, sentiments, reactions",
                    reflective: "Meta-cognition, insights, patterns",
                  },
                  types: [
                    "project-config",
                    "architecture",
                    "error-solution",
                    "preference",
                    "learned-pattern",
                    "conversation",
                  ],
                });
              }

              case "add": {
                if (!args.content) {
                  return JSON.stringify({
                    success: false,
                    error: "content parameter is required for add mode",
                  });
                }

                const sanitizedContent = stripPrivateContent(args.content);
                if (isFullyPrivate(args.content)) {
                  return JSON.stringify({
                    success: false,
                    error: "Cannot store fully private content",
                  });
                }

                const scope = args.scope === "user" ? scopes.user : scopes.project;

                const result = await openMemoryClient.addMemory(
                  sanitizedContent,
                  scope,
                  { 
                    type: args.type,
                    tags: args.sector ? [args.sector] : undefined,
                  }
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to add memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  message: `Memory added to ${args.scope || "project"} scope`,
                  id: result.id,
                  scope: args.scope || "project",
                  sector: result.sector,
                  type: args.type,
                });
              }

              case "search": {
                if (!args.query) {
                  return JSON.stringify({
                    success: false,
                    error: "query parameter is required for search mode",
                  });
                }

                const searchScope = args.scope;

                if (searchScope === "user") {
                  const result = await openMemoryClient.searchMemories(
                    args.query,
                    scopes.user,
                    { limit: args.limit, sector: args.sector }
                  );
                  if (!result.success) {
                    return JSON.stringify({
                      success: false,
                      error: result.error || "Failed to search memories",
                    });
                  }
                  return formatSearchResults(args.query, searchScope, result, args.limit);
                }

                if (searchScope === "project") {
                  const result = await openMemoryClient.searchMemories(
                    args.query,
                    scopes.project,
                    { limit: args.limit, sector: args.sector }
                  );
                  if (!result.success) {
                    return JSON.stringify({
                      success: false,
                      error: result.error || "Failed to search memories",
                    });
                  }
                  return formatSearchResults(args.query, searchScope, result, args.limit);
                }

                // Search both scopes
                const [userResult, projectResult] = await Promise.all([
                  openMemoryClient.searchMemories(args.query, scopes.user, { limit: args.limit, sector: args.sector }),
                  openMemoryClient.searchMemories(args.query, scopes.project, { limit: args.limit, sector: args.sector }),
                ]);

                if (!userResult.success || !projectResult.success) {
                  return JSON.stringify({
                    success: false,
                    error: userResult.error || projectResult.error || "Failed to search memories",
                  });
                }

                const combined = [
                  ...(userResult.results || []).map((r) => ({
                    ...r,
                    scope: "user" as const,
                  })),
                  ...(projectResult.results || []).map((r) => ({
                    ...r,
                    scope: "project" as const,
                  })),
                ].sort((a, b) => (b.score || 0) - (a.score || 0));

                return JSON.stringify({
                  success: true,
                  query: args.query,
                  count: combined.length,
                  results: combined.slice(0, args.limit || 10).map((r) => ({
                    id: r.id,
                    content: r.content,
                    score: r.score ? Math.round(r.score * 100) : null,
                    salience: r.salience ? Math.round(r.salience * 100) : null,
                    sector: r.sector,
                    scope: r.scope,
                  })),
                });
              }

              case "profile": {
                const result = await openMemoryClient.getProfile(
                  scopes.user,
                  args.query
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to fetch profile",
                  });
                }

                return JSON.stringify({
                  success: true,
                  profile: {
                    static: result.profile?.static || [],
                    dynamic: result.profile?.dynamic || [],
                  },
                });
              }

              case "list": {
                const scope = args.scope === "user" ? scopes.user : scopes.project;
                const limit = args.limit || 20;

                const result = await openMemoryClient.listMemories(scope, { 
                  limit,
                  sector: args.sector 
                });

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to list memories",
                  });
                }

                const memories = result.memories || [];
                return JSON.stringify({
                  success: true,
                  scope: args.scope || "project",
                  count: memories.length,
                  memories: memories.map((m) => ({
                    id: m.id,
                    content: m.content,
                    sector: m.sector,
                    salience: m.salience ? Math.round(m.salience * 100) : null,
                    tags: m.tags,
                    createdAt: m.createdAt,
                  })),
                });
              }

              case "forget": {
                if (!args.memoryId) {
                  return JSON.stringify({
                    success: false,
                    error: "memoryId parameter is required for forget mode",
                  });
                }

                const scope = args.scope === "user" ? scopes.user : scopes.project;

                const result = await openMemoryClient.deleteMemory(
                  args.memoryId,
                  scope
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to delete memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  message: `Memory ${args.memoryId} removed from ${args.scope || "project"} scope`,
                });
              }

              case "reinforce": {
                if (!args.memoryId) {
                  return JSON.stringify({
                    success: false,
                    error: "memoryId parameter is required for reinforce mode",
                  });
                }

                const client = getMemoryClient();
                if (!client.reinforceMemory) {
                  return JSON.stringify({
                    success: false,
                    error: "Reinforce not supported by current backend",
                  });
                }

                const result = await client.reinforceMemory(
                  args.memoryId,
                  args.boost || 0.1
                );

                if (!result.success) {
                  return JSON.stringify({
                    success: false,
                    error: result.error || "Failed to reinforce memory",
                  });
                }

                return JSON.stringify({
                  success: true,
                  message: `Memory ${args.memoryId} reinforced by ${args.boost || 0.1}`,
                });
              }

              default:
                return JSON.stringify({
                  success: false,
                  error: `Unknown mode: ${mode}`,
                });
            }
          } catch (error) {
            return JSON.stringify({
              success: false,
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      }),
    },

    event: async (input: { event: { type: string; properties?: unknown } }) => {
      if (compactionHook) {
        await compactionHook.event(input);
      }
    },
  };
};

function formatSearchResults(
  query: string,
  scope: string | undefined,
  results: { results?: Array<{ id: string; content?: string; score?: number; salience?: number; sector?: string }> },
  limit?: number
): string {
  const memoryResults = results.results || [];
  return JSON.stringify({
    success: true,
    query,
    scope,
    count: memoryResults.length,
    results: memoryResults.slice(0, limit || 10).map((r) => ({
      id: r.id,
      content: r.content,
      score: r.score ? Math.round(r.score * 100) : null,
      salience: r.salience ? Math.round(r.salience * 100) : null,
      sector: r.sector,
    })),
  });
}

// Default export for backwards compatibility
export default OpenMemoryPlugin;
