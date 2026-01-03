import { CONFIG, OPENMEMORY_API_URL, OPENMEMORY_API_KEY } from "../config.js";
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

let clientInstance: OpenMemoryRESTClient | null = null;

export function getMemoryClient(): IMemoryBackendClient {
  if (!clientInstance) {
    clientInstance = new OpenMemoryRESTClient();
  }
  return clientInstance;
}

export const openMemoryClient = {
  get client(): IMemoryBackendClient {
    return getMemoryClient();
  },
  
  searchMemories: (query: string, scope: MemoryScopeContext, options?: { limit?: number; minSalience?: number; sector?: MemorySector }) => 
    getMemoryClient().searchMemories(query, scope, options),
  
  addMemory: (content: string, scope: MemoryScopeContext, options?: { type?: MemoryType; tags?: string[]; metadata?: Record<string, unknown> }) => 
    getMemoryClient().addMemory(content, scope, options),
  
  listMemories: (scope: MemoryScopeContext, options?: { limit?: number; sector?: MemorySector }) => 
    getMemoryClient().listMemories(scope, options),
  
  deleteMemory: (memoryId: string, scope: MemoryScopeContext) => 
    getMemoryClient().deleteMemory(memoryId, scope),
  
  getProfile: (scope: MemoryScopeContext, query?: string) => 
    getMemoryClient().getProfile(scope, query),
};
