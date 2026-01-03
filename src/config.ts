import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { stripJsoncComments } from "./services/jsonc.js";

const CONFIG_DIR = join(homedir(), ".config", "opencode");
const CONFIG_FILES = [
  join(CONFIG_DIR, "openmemory.jsonc"),
  join(CONFIG_DIR, "openmemory.json"),
];

export type BackendType = "openmemory" | "openmemory-rest";

interface OpenMemoryConfig {
  // Backend selection
  backend?: BackendType;
  
  // OpenMemory REST API settings (when using REST backend)
  apiUrl?: string;
  apiKey?: string;
  
  // Search/retrieval settings
  similarityThreshold?: number;
  maxMemories?: number;
  maxProjectMemories?: number;
  maxProfileItems?: number;
  minSalience?: number;
  
  // Injection settings
  injectProfile?: boolean;
  
  // Scope prefix for organizing memories
  scopePrefix?: string;
  
  // Default sector for storing memories
  defaultSector?: string;
}

const DEFAULTS: Required<Omit<OpenMemoryConfig, "apiKey">> = {
  backend: "openmemory",
  apiUrl: "http://localhost:8765",
  similarityThreshold: 0.6,
  maxMemories: 5,
  maxProjectMemories: 10,
  maxProfileItems: 5,
  minSalience: 0.3,
  injectProfile: true,
  scopePrefix: "opencode",
  defaultSector: "semantic",
};

function loadConfig(): OpenMemoryConfig {
  for (const path of CONFIG_FILES) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        const json = stripJsoncComments(content);
        return JSON.parse(json) as OpenMemoryConfig;
      } catch {
        // Invalid config, use defaults
      }
    }
  }
  return {};
}

const fileConfig = loadConfig();

export const OPENMEMORY_API_KEY = fileConfig.apiKey ?? process.env.OPENMEMORY_API_KEY;
export const OPENMEMORY_API_URL = fileConfig.apiUrl ?? process.env.OPENMEMORY_API_URL ?? DEFAULTS.apiUrl;

export const CONFIG = {
  backend: (fileConfig.backend ?? process.env.OPENMEMORY_BACKEND ?? DEFAULTS.backend) as BackendType,
  apiUrl: OPENMEMORY_API_URL,
  similarityThreshold: fileConfig.similarityThreshold ?? DEFAULTS.similarityThreshold,
  maxMemories: fileConfig.maxMemories ?? DEFAULTS.maxMemories,
  maxProjectMemories: fileConfig.maxProjectMemories ?? DEFAULTS.maxProjectMemories,
  maxProfileItems: fileConfig.maxProfileItems ?? DEFAULTS.maxProfileItems,
  minSalience: fileConfig.minSalience ?? DEFAULTS.minSalience,
  injectProfile: fileConfig.injectProfile ?? DEFAULTS.injectProfile,
  scopePrefix: fileConfig.scopePrefix ?? DEFAULTS.scopePrefix,
  defaultSector: fileConfig.defaultSector ?? DEFAULTS.defaultSector,
};

export function isConfigured(): boolean {
  // OpenMemory MCP doesn't require API key (local), REST might
  if (CONFIG.backend === "openmemory") {
    return true; // MCP tools are available via opencode
  }
  // REST backend may need API key depending on setup
  return true;
}

export function getBackendType(): BackendType {
  return CONFIG.backend;
}
