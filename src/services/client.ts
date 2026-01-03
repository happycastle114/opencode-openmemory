import { CONFIG, OPENMEMORY_API_URL, OPENMEMORY_API_KEY, getBackendType } from "../config.js";
import { log } from "./logger.js";
import type {
  IMemoryBackendClient,
  MemoryScopeContext,
  MemoryType,
  MemorySector,
  SearchMemoriesResult,
  AddMemoryResult,
  ListMemoriesResult,
  DeleteMemoryResult,
  ProfileResult,
  MemoryItem,
} from "../types/index.js";

const TIMEOUT_MS = 30000;

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Timeout after ${ms}ms`)), ms)
    ),
  ]);
}

export class OpenMemoryMCPClient implements IMemoryBackendClient {
  private mcpCaller: ((toolName: string, args: Record<string, unknown>) => Promise<unknown>) | null = null;

  setMCPCaller(caller: (toolName: string, args: Record<string, unknown>) => Promise<unknown>) {
    this.mcpCaller = caller;
  }

  private getScopeUserId(scope: MemoryScopeContext): string {
    if (scope.projectId) {
      return `${CONFIG.scopePrefix}:${scope.userId}:${scope.projectId}`;
    }
    return `${CONFIG.scopePrefix}:${scope.userId}`;
  }

  private async callMCP<T>(toolName: string, args: Record<string, unknown>): Promise<T> {
    if (!this.mcpCaller) {
      throw new Error("MCP caller not configured");
    }
    return this.mcpCaller(toolName, args) as Promise<T>;
  }

  async searchMemories(
    query: string,
    scope: MemoryScopeContext,
    options?: { limit?: number; minSalience?: number; sector?: MemorySector }
  ): Promise<SearchMemoriesResult> {
    log("OpenMemoryMCP.searchMemories", { query: query.slice(0, 50), scope });
    
    try {
      const userId = this.getScopeUserId(scope);
      
      const result = await this.callMCP<{ matches?: Array<{ id: string; content?: string; content_preview?: string; score?: number; salience?: number; primary_sector?: string; tags?: string[]; metadata?: Record<string, unknown> }> }>(
        "openmemory_openmemory_query",
        {
          query,
          k: options?.limit ?? CONFIG.maxMemories,
          min_salience: options?.minSalience ?? CONFIG.minSalience,
          sector: options?.sector,
          user_id: userId,
        }
      );

      const memories: MemoryItem[] = (result.matches || []).map((m) => ({
        id: m.id,
        content: m.content || m.content_preview || "",
        score: m.score,
        salience: m.salience,
        sector: m.primary_sector as MemorySector,
        tags: m.tags,
        metadata: m.metadata,
      }));

      log("OpenMemoryMCP.searchMemories: success", { count: memories.length });
      return { success: true, results: memories, total: memories.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryMCP.searchMemories: error", { error: errorMessage });
      return { success: false, results: [], total: 0, error: errorMessage };
    }
  }

  async addMemory(
    content: string,
    scope: MemoryScopeContext,
    options?: { type?: MemoryType; tags?: string[]; metadata?: Record<string, unknown> }
  ): Promise<AddMemoryResult> {
    log("OpenMemoryMCP.addMemory", { contentLength: content.length, scope });
    
    try {
      const userId = this.getScopeUserId(scope);
      const tags = [...(options?.tags || [])];
      if (options?.type) tags.push(options.type);
      if (scope.projectId) tags.push(`project:${scope.projectId}`);

      const result = await this.callMCP<{ id?: string; primary_sector?: string }>(
        "openmemory_openmemory_store",
        {
          content,
          tags,
          metadata: {
            ...options?.metadata,
            type: options?.type,
            scope: scope.projectId ? "project" : "user",
            project_id: scope.projectId,
          },
          user_id: userId,
        }
      );

      log("OpenMemoryMCP.addMemory: success", { id: result.id });
      return { success: true, id: result.id, sector: result.primary_sector as MemorySector };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryMCP.addMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async listMemories(
    scope: MemoryScopeContext,
    options?: { limit?: number; sector?: MemorySector }
  ): Promise<ListMemoriesResult> {
    log("OpenMemoryMCP.listMemories", { scope, limit: options?.limit });
    
    try {
      const userId = this.getScopeUserId(scope);

      const result = await this.callMCP<{ items?: Array<{ id: string; content?: string; content_preview?: string; salience?: number; primary_sector?: string; tags?: string[]; metadata?: Record<string, unknown>; created_at?: string }> }>(
        "openmemory_openmemory_list",
        {
          limit: options?.limit ?? CONFIG.maxProjectMemories,
          sector: options?.sector,
          user_id: userId,
        }
      );

      const memories: MemoryItem[] = (result.items || []).map((m) => ({
        id: m.id,
        content: m.content || m.content_preview || "",
        salience: m.salience,
        sector: m.primary_sector as MemorySector,
        tags: m.tags,
        metadata: m.metadata,
        createdAt: m.created_at,
      }));

      log("OpenMemoryMCP.listMemories: success", { count: memories.length });
      return { success: true, memories, total: memories.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryMCP.listMemories: error", { error: errorMessage });
      return { success: false, memories: [], error: errorMessage };
    }
  }

  async deleteMemory(_memoryId: string, _scope: MemoryScopeContext): Promise<DeleteMemoryResult> {
    log("OpenMemoryMCP.deleteMemory: not supported via MCP");
    return { success: false, error: "Delete not supported via MCP. Use reinforce with negative boost." };
  }

  async getProfile(scope: MemoryScopeContext, query?: string): Promise<ProfileResult> {
    log("OpenMemoryMCP.getProfile", { scope, query: query?.slice(0, 50) });
    
    try {
      const userId = this.getScopeUserId({ userId: scope.userId });
      
      const result = await this.callMCP<{ matches?: Array<{ content?: string; content_preview?: string; salience?: number; last_seen_at?: string }> }>(
        "openmemory_openmemory_query",
        {
          query: query || "user preferences coding style workflow",
          k: CONFIG.maxProfileItems * 2,
          sector: "semantic",
          min_salience: 0.5,
          user_id: userId,
        }
      );

      const matches = result.matches || [];
      
      const staticFacts = matches
        .filter((m) => (m.salience ?? 0) >= 0.7)
        .slice(0, CONFIG.maxProfileItems)
        .map((m) => m.content || m.content_preview || "");
      
      const dynamicFacts = [...matches]
        .sort((a, b) => new Date(b.last_seen_at || 0).getTime() - new Date(a.last_seen_at || 0).getTime())
        .filter((m) => (m.salience ?? 0) < 0.7)
        .slice(0, CONFIG.maxProfileItems)
        .map((m) => m.content || m.content_preview || "");

      log("OpenMemoryMCP.getProfile: success", { staticCount: staticFacts.length, dynamicCount: dynamicFacts.length });
      return { success: true, profile: { static: staticFacts, dynamic: dynamicFacts } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryMCP.getProfile: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async reinforceMemory(memoryId: string, boost = 0.1): Promise<{ success: boolean; error?: string }> {
    log("OpenMemoryMCP.reinforceMemory", { memoryId, boost });
    
    try {
      await this.callMCP("openmemory_openmemory_reinforce", { id: memoryId, boost });
      log("OpenMemoryMCP.reinforceMemory: success");
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryMCP.reinforceMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
}

export class OpenMemoryRESTClient implements IMemoryBackendClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor() {
    this.baseUrl = OPENMEMORY_API_URL;
    this.apiKey = OPENMEMORY_API_KEY;
  }

  private async fetch(path: string, options: RequestInit = {}): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      ...(options.headers as Record<string, string>),
    };

    if (this.apiKey) {
      headers["Authorization"] = `Bearer ${this.apiKey}`;
    }

    return withTimeout(
      fetch(`${this.baseUrl}${path}`, { ...options, headers }),
      TIMEOUT_MS
    );
  }

  private getScopeUserId(scope: MemoryScopeContext): string {
    if (scope.projectId) {
      return `${CONFIG.scopePrefix}:${scope.userId}:${scope.projectId}`;
    }
    return `${CONFIG.scopePrefix}:${scope.userId}`;
  }

  async searchMemories(
    query: string,
    scope: MemoryScopeContext,
    options?: { limit?: number; minSalience?: number; sector?: MemorySector }
  ): Promise<SearchMemoriesResult> {
    log("OpenMemoryREST.searchMemories", { query: query.slice(0, 50), scope });
    
    try {
      const userId = this.getScopeUserId(scope);
      const params = new URLSearchParams({
        user_id: userId,
        search_query: query,
        size: String(options?.limit ?? CONFIG.maxMemories),
      });

      const response = await this.fetch(`/api/v1/memories/?${params}`);
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, results: [], total: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { items?: Array<{ id: string; content?: string; text?: string; categories?: string[]; metadata_?: Record<string, unknown>; created_at?: string }>; total?: number };
      const memories: MemoryItem[] = (data.items || []).map((m) => ({
        id: m.id,
        content: m.content || m.text || "",
        score: 1,
        tags: m.categories,
        metadata: m.metadata_,
        createdAt: m.created_at,
      }));

      log("OpenMemoryREST.searchMemories: success", { count: memories.length });
      return { success: true, results: memories, total: data.total || memories.length };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.searchMemories: error", { error: errorMessage });
      return { success: false, results: [], total: 0, error: errorMessage };
    }
  }

  async addMemory(
    content: string,
    scope: MemoryScopeContext,
    options?: { type?: MemoryType; tags?: string[]; metadata?: Record<string, unknown> }
  ): Promise<AddMemoryResult> {
    log("OpenMemoryREST.addMemory", { contentLength: content.length, scope });
    
    try {
      const userId = this.getScopeUserId(scope);

      const response = await this.fetch("/api/v1/memories/", {
        method: "POST",
        body: JSON.stringify({
          user_id: userId,
          text: content,
          metadata: {
            ...options?.metadata,
            type: options?.type,
            tags: options?.tags,
            scope: scope.projectId ? "project" : "user",
            project_id: scope.projectId,
          },
          infer: true,
          app: "opencode-openmemory",
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { id?: string };
      log("OpenMemoryREST.addMemory: success", { id: data.id });
      return { success: true, id: data.id };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.addMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async listMemories(
    scope: MemoryScopeContext,
    options?: { limit?: number; sector?: MemorySector }
  ): Promise<ListMemoriesResult> {
    log("OpenMemoryREST.listMemories", { scope, limit: options?.limit });
    
    try {
      const userId = this.getScopeUserId(scope);
      const params = new URLSearchParams({
        user_id: userId,
        size: String(options?.limit ?? CONFIG.maxProjectMemories),
        sort_column: "created_at",
        sort_direction: "desc",
      });

      const response = await this.fetch(`/api/v1/memories/?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, memories: [], error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { items?: Array<{ id: string; content?: string; text?: string; categories?: string[]; metadata_?: Record<string, unknown>; created_at?: string }>; total?: number };
      const memories: MemoryItem[] = (data.items || []).map((m) => ({
        id: m.id,
        content: m.content || m.text || "",
        tags: m.categories,
        metadata: m.metadata_,
        createdAt: m.created_at,
      }));

      log("OpenMemoryREST.listMemories: success", { count: memories.length });
      return { success: true, memories, total: data.total };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.listMemories: error", { error: errorMessage });
      return { success: false, memories: [], error: errorMessage };
    }
  }

  async deleteMemory(memoryId: string, scope: MemoryScopeContext): Promise<DeleteMemoryResult> {
    log("OpenMemoryREST.deleteMemory", { memoryId });
    
    try {
      const userId = this.getScopeUserId(scope);

      const response = await this.fetch("/api/v1/memories/", {
        method: "DELETE",
        body: JSON.stringify({ memory_ids: [memoryId], user_id: userId }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      log("OpenMemoryREST.deleteMemory: success");
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.deleteMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async getProfile(scope: MemoryScopeContext, query?: string): Promise<ProfileResult> {
    log("OpenMemoryREST.getProfile", { scope });
    
    try {
      const userScope = { userId: scope.userId };
      const result = await this.searchMemories(query || "preferences style workflow", userScope, { limit: CONFIG.maxProfileItems * 2 });

      if (!result.success) {
        return { success: false, error: result.error };
      }

      const now = Date.now();
      const oneWeekAgo = now - 7 * 24 * 60 * 60 * 1000;

      const staticFacts = result.results
        .filter(m => m.createdAt && new Date(m.createdAt).getTime() < oneWeekAgo)
        .slice(0, CONFIG.maxProfileItems)
        .map(m => m.content);

      const dynamicFacts = result.results
        .filter(m => !m.createdAt || new Date(m.createdAt).getTime() >= oneWeekAgo)
        .slice(0, CONFIG.maxProfileItems)
        .map(m => m.content);

      log("OpenMemoryREST.getProfile: success", { staticCount: staticFacts.length, dynamicCount: dynamicFacts.length });
      return { success: true, profile: { static: staticFacts, dynamic: dynamicFacts } };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.getProfile: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }
}

export function createMemoryClient(): IMemoryBackendClient {
  const backend = getBackendType();
  
  if (backend === "openmemory-rest") {
    log("Creating OpenMemory REST client");
    return new OpenMemoryRESTClient();
  }
  
  log("Creating OpenMemory MCP client");
  return new OpenMemoryMCPClient();
}

let memoryClientInstance: IMemoryBackendClient | null = null;
let mcpCallerConfigured = false;

export function getMemoryClient(): IMemoryBackendClient {
  if (!memoryClientInstance) {
    memoryClientInstance = createMemoryClient();
  }
  return memoryClientInstance;
}

export function setMCPCaller(caller: (toolName: string, args: Record<string, unknown>) => Promise<unknown>): void {
  const client = getMemoryClient();
  if (client instanceof OpenMemoryMCPClient) {
    client.setMCPCaller(caller);
    mcpCallerConfigured = true;
    log("MCP caller configured for OpenMemory client");
  }
}

export function isMCPConfigured(): boolean {
  return mcpCallerConfigured && getBackendType() === "openmemory";
}

export function getEffectiveClient(): IMemoryBackendClient {
  if (getBackendType() === "openmemory" && !mcpCallerConfigured) {
    log("MCP not configured, falling back to REST client");
    return new OpenMemoryRESTClient();
  }
  return getMemoryClient();
}

export const openMemoryClient = {
  get client(): IMemoryBackendClient {
    return getEffectiveClient();
  },
  
  searchMemories: (query: string, scope: MemoryScopeContext, options?: { limit?: number; minSalience?: number; sector?: MemorySector }) => 
    getEffectiveClient().searchMemories(query, scope, options),
  
  addMemory: (content: string, scope: MemoryScopeContext, options?: { type?: MemoryType; tags?: string[]; metadata?: Record<string, unknown> }) => 
    getEffectiveClient().addMemory(content, scope, options),
  
  listMemories: (scope: MemoryScopeContext, options?: { limit?: number; sector?: MemorySector }) => 
    getEffectiveClient().listMemories(scope, options),
  
  deleteMemory: (memoryId: string, scope: MemoryScopeContext) => 
    getEffectiveClient().deleteMemory(memoryId, scope),
  
  getProfile: (scope: MemoryScopeContext, query?: string) => 
    getEffectiveClient().getProfile(scope, query),
};
