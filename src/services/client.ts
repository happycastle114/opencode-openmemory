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
  TemporalFact,
  CreateTemporalFactInput,
  CreateTemporalFactResult,
  QueryTemporalFactsInput,
  QueryTemporalFactsResult,
  GetCurrentFactInput,
  GetCurrentFactResult,
  GetTimelineInput,
  GetTimelineResult,
  InvalidateFactInput,
  InvalidateFactResult,
  TemporalStatsResult,
  CompareFactsInput,
  CompareFactsResult,
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

interface OpenMemoryQueryResponse {
  query: string;
  matches: Array<{
    id: string;
    content: string;
    score?: number;
    sectors?: string[];
    primary_sector?: string;
    path?: string;
    salience?: number;
    last_seen_at?: number;
  }>;
}

interface OpenMemoryAddResponse {
  id: string;
  root_memory_id?: string;
  primary_sector?: string;
}

interface OpenMemoryListResponse {
  items: Array<{
    id: string;
    content: string;
    tags?: string[];
    metadata?: Record<string, unknown>;
    created_at?: number;
    updated_at?: number;
    last_seen_at?: number;
    salience?: number;
    decay_lambda?: number;
    primary_sector?: string;
    version?: number;
    user_id?: string;
  }>;
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

      const response = await this.fetch("/memory/query", {
        method: "POST",
        body: JSON.stringify({
          query,
          k: options?.limit ?? CONFIG.maxMemories,
          user_id: userId,
          filters: {
            user_id: userId,
            ...(options?.minSalience !== undefined && { min_score: options.minSalience }),
            ...(options?.sector && { sector: options.sector }),
          },
        }),
      });
      
      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, results: [], total: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as OpenMemoryQueryResponse;
      const memories: MemoryItem[] = (data.matches || []).map((m) => ({
        id: m.id,
        content: m.content,
        score: m.score ?? m.salience ?? 1,
        salience: m.salience,
        sector: m.primary_sector as MemorySector | undefined,
      }));

      log("OpenMemoryREST.searchMemories: success", { count: memories.length });
      return { success: true, results: memories, total: memories.length };
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

      const response = await this.fetch("/memory/add", {
        method: "POST",
        body: JSON.stringify({
          content,
          user_id: userId,
          tags: options?.tags,
          metadata: {
            ...options?.metadata,
            type: options?.type,
            scope: scope.projectId ? "project" : "user",
            project_id: scope.projectId,
            source: "opencode-openmemory",
          },
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as OpenMemoryAddResponse;
      log("OpenMemoryREST.addMemory: success", { id: data.id });
      return { success: true, id: data.id, sector: data.primary_sector as MemorySector | undefined };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.addMemory: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async listMemories(
    scope: MemoryScopeContext,
    options?: { limit?: number; offset?: number; sector?: MemorySector }
  ): Promise<ListMemoriesResult> {
    log("OpenMemoryREST.listMemories", { scope, limit: options?.limit });
    
    try {
      const userId = this.getScopeUserId(scope);
      const params = new URLSearchParams({
        user_id: userId,
        l: String(options?.limit ?? CONFIG.maxProjectMemories),
      });

      if (options?.offset !== undefined) {
        params.set("u", String(options.offset));
      }

      if (options?.sector) {
        params.set("sector", options.sector);
      }

      const response = await this.fetch(`/memory/all?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, memories: [], error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as OpenMemoryListResponse;
      const memories: MemoryItem[] = (data.items || []).map((m) => ({
        id: m.id,
        content: m.content,
        salience: m.salience,
        sector: m.primary_sector as MemorySector | undefined,
        tags: m.tags,
        metadata: m.metadata,
        createdAt: m.created_at ? new Date(m.created_at * 1000).toISOString() : undefined,
        updatedAt: m.updated_at ? new Date(m.updated_at * 1000).toISOString() : undefined,
      }));

      log("OpenMemoryREST.listMemories: success", { count: memories.length });
      return { success: true, memories, total: memories.length };
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
      const params = new URLSearchParams({ user_id: userId });

      const response = await this.fetch(`/memory/${encodeURIComponent(memoryId)}?${params}`, {
        method: "DELETE",
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

  async reinforceMemory(memoryId: string, boost: number = 0.1): Promise<{ success: boolean; error?: string }> {
    log("OpenMemoryREST.reinforceMemory", { memoryId, boost });
    
    try {
      const response = await this.fetch("/memory/reinforce", {
        method: "POST",
        body: JSON.stringify({
          id: memoryId,
          boost,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      log("OpenMemoryREST.reinforceMemory: success");
      return { success: true };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.reinforceMemory: error", { error: errorMessage });
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

  async createTemporalFact(input: CreateTemporalFactInput): Promise<CreateTemporalFactResult> {
    log("OpenMemoryREST.createTemporalFact", { subject: input.subject, predicate: input.predicate });
    
    try {
      const response = await this.fetch("/api/temporal/fact", {
        method: "POST",
        body: JSON.stringify({
          subject: input.subject,
          predicate: input.predicate,
          object: input.object,
          valid_from: input.validFrom,
          confidence: input.confidence,
          metadata: input.metadata,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as {
        id: string;
        subject: string;
        predicate: string;
        object: string;
        valid_from: string;
        confidence: number;
      };
      
      log("OpenMemoryREST.createTemporalFact: success", { id: data.id });
      return {
        success: true,
        id: data.id,
        subject: data.subject,
        predicate: data.predicate,
        object: data.object,
        valid_from: data.valid_from,
        confidence: data.confidence,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.createTemporalFact: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async queryTemporalFacts(input: QueryTemporalFactsInput): Promise<QueryTemporalFactsResult> {
    log("OpenMemoryREST.queryTemporalFacts", { subject: input.subject, predicate: input.predicate });
    
    try {
      const params = new URLSearchParams();
      if (input.subject) params.set("subject", input.subject);
      if (input.predicate) params.set("predicate", input.predicate);
      if (input.object) params.set("object", input.object);
      if (input.at) params.set("at", input.at);
      if (input.minConfidence !== undefined) params.set("min_confidence", String(input.minConfidence));

      const response = await this.fetch(`/api/temporal/fact?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, facts: [], count: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { facts: TemporalFact[]; count: number };
      log("OpenMemoryREST.queryTemporalFacts: success", { count: data.count });
      return { success: true, facts: data.facts, count: data.count };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.queryTemporalFacts: error", { error: errorMessage });
      return { success: false, facts: [], count: 0, error: errorMessage };
    }
  }

  async getCurrentFact(input: GetCurrentFactInput): Promise<GetCurrentFactResult> {
    log("OpenMemoryREST.getCurrentFact", { subject: input.subject, predicate: input.predicate });
    
    try {
      const params = new URLSearchParams({
        subject: input.subject,
        predicate: input.predicate,
      });

      const response = await this.fetch(`/api/temporal/fact/current?${params}`);

      if (!response.ok) {
        if (response.status === 404) {
          return { success: true, fact: undefined };
        }
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { fact: TemporalFact };
      log("OpenMemoryREST.getCurrentFact: success", { id: data.fact?.id });
      return { success: true, fact: data.fact };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.getCurrentFact: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async getTimeline(input: GetTimelineInput): Promise<GetTimelineResult> {
    log("OpenMemoryREST.getTimeline", { subject: input.subject, predicate: input.predicate });
    
    try {
      const params = new URLSearchParams({ subject: input.subject });
      if (input.predicate) params.set("predicate", input.predicate);

      const response = await this.fetch(`/api/temporal/timeline?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, subject: input.subject, timeline: [], count: 0, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { subject: string; predicate?: string; timeline: any[]; count: number };
      log("OpenMemoryREST.getTimeline: success", { count: data.count });
      return {
        success: true,
        subject: data.subject,
        predicate: data.predicate,
        timeline: data.timeline,
        count: data.count,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.getTimeline: error", { error: errorMessage });
      return { success: false, subject: input.subject, timeline: [], count: 0, error: errorMessage };
    }
  }

  async invalidateFact(input: InvalidateFactInput): Promise<InvalidateFactResult> {
    log("OpenMemoryREST.invalidateFact", { id: input.id });
    
    try {
      const response = await this.fetch(`/api/temporal/fact/${encodeURIComponent(input.id)}`, {
        method: "DELETE",
        body: JSON.stringify({ valid_to: input.validTo }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { id: string; valid_to: string };
      log("OpenMemoryREST.invalidateFact: success");
      return { success: true, id: data.id, valid_to: data.valid_to };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.invalidateFact: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async getTemporalStats(): Promise<TemporalStatsResult> {
    log("OpenMemoryREST.getTemporalStats");
    
    try {
      const response = await this.fetch("/api/temporal/stats");

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as { active_facts: number; historical_facts: number; total_facts: number };
      log("OpenMemoryREST.getTemporalStats: success", { total: data.total_facts });
      return {
        success: true,
        active_facts: data.active_facts,
        historical_facts: data.historical_facts,
        total_facts: data.total_facts,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.getTemporalStats: error", { error: errorMessage });
      return { success: false, error: errorMessage };
    }
  }

  async compareFacts(input: CompareFactsInput): Promise<CompareFactsResult> {
    log("OpenMemoryREST.compareFacts", { subject: input.subject, time1: input.time1, time2: input.time2 });
    
    try {
      const params = new URLSearchParams({
        subject: input.subject,
        time1: input.time1,
        time2: input.time2,
      });

      const response = await this.fetch(`/api/temporal/compare?${params}`);

      if (!response.ok) {
        const errorText = await response.text();
        return { success: false, added: [], removed: [], changed: [], unchanged: [], error: `HTTP ${response.status}: ${errorText}` };
      }

      const data = await response.json() as {
        subject: string;
        time1: string;
        time2: string;
        added: TemporalFact[];
        removed: TemporalFact[];
        changed: Array<{ before: TemporalFact; after: TemporalFact }>;
        unchanged: TemporalFact[];
      };
      
      log("OpenMemoryREST.compareFacts: success");
      return {
        success: true,
        subject: data.subject,
        time1: data.time1,
        time2: data.time2,
        added: data.added,
        removed: data.removed,
        changed: data.changed,
        unchanged: data.unchanged,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      log("OpenMemoryREST.compareFacts: error", { error: errorMessage });
      return { success: false, added: [], removed: [], changed: [], unchanged: [], error: errorMessage };
    }
  }
}

let clientInstance: OpenMemoryRESTClient | null = null;

export function getMemoryClient(): OpenMemoryRESTClient {
  if (!clientInstance) {
    clientInstance = new OpenMemoryRESTClient();
  }
  return clientInstance;
}

export const openMemoryClient = {
  get client(): OpenMemoryRESTClient {
    return getMemoryClient();
  },
  
  searchMemories: (query: string, scope: MemoryScopeContext, options?: { limit?: number; minSalience?: number; sector?: MemorySector }) => 
    getMemoryClient().searchMemories(query, scope, options),
  
  addMemory: (content: string, scope: MemoryScopeContext, options?: { type?: MemoryType; tags?: string[]; metadata?: Record<string, unknown> }) => 
    getMemoryClient().addMemory(content, scope, options),
  
  listMemories: (scope: MemoryScopeContext, options?: { limit?: number; offset?: number; sector?: MemorySector }) => 
    getMemoryClient().listMemories(scope, options),
  
  deleteMemory: (memoryId: string, scope: MemoryScopeContext) => 
    getMemoryClient().deleteMemory(memoryId, scope),
  
  getProfile: (scope: MemoryScopeContext, query?: string) => 
    getMemoryClient().getProfile(scope, query),

  reinforceMemory: (memoryId: string, boost?: number) =>
    getMemoryClient().reinforceMemory(memoryId, boost),

  createTemporalFact: (input: CreateTemporalFactInput) =>
    getMemoryClient().createTemporalFact(input),

  queryTemporalFacts: (input: QueryTemporalFactsInput) =>
    getMemoryClient().queryTemporalFacts(input),

  getCurrentFact: (input: GetCurrentFactInput) =>
    getMemoryClient().getCurrentFact(input),

  getTimeline: (input: GetTimelineInput) =>
    getMemoryClient().getTimeline(input),

  invalidateFact: (input: InvalidateFactInput) =>
    getMemoryClient().invalidateFact(input),

  getTemporalStats: () =>
    getMemoryClient().getTemporalStats(),

  compareFacts: (input: CompareFactsInput) =>
    getMemoryClient().compareFacts(input),
};
