// Legacy scope type for tool arguments (user vs project selection)
export type MemoryScopeType = "user" | "project";

export type MemoryType =
  | "project-config"
  | "architecture"
  | "error-solution"
  | "preference"
  | "learned-pattern"
  | "conversation";

export type ConversationRole = "user" | "assistant" | "system" | "tool";

export type ConversationContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; imageUrl: { url: string } };

export interface ConversationToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface ConversationMessage {
  role: ConversationRole;
  content: string | ConversationContentPart[];
  name?: string;
  tool_calls?: ConversationToolCall[];
  tool_call_id?: string;
}

export interface ConversationIngestResponse {
  id: string;
  conversationId: string;
  status: string;
}

// OpenMemory sector types (HSG - Hierarchical Semantic Graph)
export type MemorySector = 
  | "episodic"    // Events, experiences, temporal sequences
  | "semantic"    // Facts, concepts, general knowledge
  | "procedural"  // Skills, how-to knowledge, processes
  | "emotional"   // Feelings, sentiments, reactions
  | "reflective"; // Meta-cognition, insights, patterns

// Memory Backend Client Interface (Adapter Pattern)
export interface MemoryItem {
  id: string;
  content: string;
  score?: number;
  salience?: number;
  sector?: MemorySector;
  tags?: string[];
  metadata?: Record<string, unknown>;
  createdAt?: string;
  updatedAt?: string;
}

export interface SearchMemoriesResult {
  success: boolean;
  results: MemoryItem[];
  total: number;
  timing?: number;
  error?: string;
}

export interface AddMemoryResult {
  success: boolean;
  id?: string;
  sector?: MemorySector;
  error?: string;
}

export interface ListMemoriesResult {
  success: boolean;
  memories: MemoryItem[];
  total?: number;
  error?: string;
}

export interface DeleteMemoryResult {
  success: boolean;
  error?: string;
}

export interface ProfileResult {
  success: boolean;
  profile?: {
    static: string[];
    dynamic: string[];
  };
  error?: string;
}

export interface MemoryScopeContext {
  userId: string;
  projectId?: string;
}

// Abstract Memory Backend Client Interface
export interface IMemoryBackendClient {
  searchMemories(query: string, scope: MemoryScopeContext, options?: {
    limit?: number;
    minSalience?: number;
    sector?: MemorySector;
  }): Promise<SearchMemoriesResult>;

  addMemory(content: string, scope: MemoryScopeContext, options?: {
    type?: MemoryType;
    tags?: string[];
    metadata?: Record<string, unknown>;
  }): Promise<AddMemoryResult>;

  listMemories(scope: MemoryScopeContext, options?: {
    limit?: number;
    sector?: MemorySector;
  }): Promise<ListMemoriesResult>;

  deleteMemory(memoryId: string, scope: MemoryScopeContext): Promise<DeleteMemoryResult>;

  getProfile(scope: MemoryScopeContext, query?: string): Promise<ProfileResult>;

  reinforceMemory?(memoryId: string, boost?: number): Promise<{ success: boolean; salience?: number; error?: string }>;
}

// Temporal Knowledge Graph types
export interface TemporalFact {
  id: string;
  subject: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to?: string;
  confidence: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
}

export interface CreateTemporalFactInput {
  subject: string;
  predicate: string;
  object: string;
  validFrom?: string;
  confidence?: number;
  metadata?: Record<string, unknown>;
}

export interface CreateTemporalFactResult {
  success: boolean;
  id?: string;
  subject?: string;
  predicate?: string;
  object?: string;
  valid_from?: string;
  confidence?: number;
  error?: string;
}

export interface QueryTemporalFactsInput {
  subject?: string;
  predicate?: string;
  object?: string;
  at?: string;
  minConfidence?: number;
}

export interface QueryTemporalFactsResult {
  success: boolean;
  facts: TemporalFact[];
  count: number;
  error?: string;
}

export interface GetCurrentFactInput {
  subject: string;
  predicate: string;
}

export interface GetCurrentFactResult {
  success: boolean;
  fact?: TemporalFact;
  error?: string;
}

export interface GetTimelineInput {
  subject: string;
  predicate?: string;
}

export interface TimelineEntry {
  id: string;
  predicate: string;
  object: string;
  valid_from: string;
  valid_to?: string;
  confidence: number;
}

export interface GetTimelineResult {
  success: boolean;
  subject: string;
  predicate?: string;
  timeline: TimelineEntry[];
  count: number;
  error?: string;
}

export interface InvalidateFactInput {
  id: string;
  validTo?: string;
}

export interface InvalidateFactResult {
  success: boolean;
  id?: string;
  valid_to?: string;
  error?: string;
}

export interface TemporalStatsResult {
  success: boolean;
  active_facts?: number;
  historical_facts?: number;
  total_facts?: number;
  error?: string;
}

export interface CompareFactsInput {
  subject: string;
  time1: string;
  time2: string;
}

export interface CompareFactsResult {
  success: boolean;
  subject?: string;
  time1?: string;
  time2?: string;
  added: TemporalFact[];
  removed: TemporalFact[];
  changed: Array<{ before: TemporalFact; after: TemporalFact }>;
  unchanged: TemporalFact[];
  error?: string;
}
