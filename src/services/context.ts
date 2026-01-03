import { CONFIG } from "../config.js";
import type { MemoryItem, ProfileResult } from "../types/index.js";

interface MemoriesResponseMinimal {
  results?: MemoryItem[];
  memories?: MemoryItem[];
}

export function formatContextForPrompt(
  profile: ProfileResult | null,
  userMemories: MemoriesResponseMinimal,
  projectMemories: MemoriesResponseMinimal
): string {
  const parts: string[] = ["[OPENMEMORY]"];

  if (CONFIG.injectProfile && profile?.profile) {
    const { static: staticFacts, dynamic: dynamicFacts } = profile.profile;

    if (staticFacts.length > 0) {
      parts.push("\nUser Profile:");
      staticFacts.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
        parts.push(`- ${fact}`);
      });
    }

    if (dynamicFacts.length > 0) {
      parts.push("\nRecent Context:");
      dynamicFacts.slice(0, CONFIG.maxProfileItems).forEach((fact) => {
        parts.push(`- ${fact}`);
      });
    }
  }

  const projectResults = projectMemories.results || projectMemories.memories || [];
  if (projectResults.length > 0) {
    parts.push("\nProject Knowledge:");
    projectResults.forEach((mem) => {
      const score = mem.score ? Math.round(mem.score * 100) : null;
      const salience = mem.salience ? Math.round(mem.salience * 100) : null;
      const content = mem.content || "";
      
      if (score !== null) {
        parts.push(`- [${score}%] ${content}`);
      } else if (salience !== null) {
        parts.push(`- [sal:${salience}%] ${content}`);
      } else {
        parts.push(`- ${content}`);
      }
    });
  }

  const userResults = userMemories.results || userMemories.memories || [];
  if (userResults.length > 0) {
    parts.push("\nRelevant Memories:");
    userResults.forEach((mem) => {
      const score = mem.score ? Math.round(mem.score * 100) : null;
      const salience = mem.salience ? Math.round(mem.salience * 100) : null;
      const content = mem.content || "";
      const sector = mem.sector ? `[${mem.sector}]` : "";
      
      if (score !== null) {
        parts.push(`- ${sector}[${score}%] ${content}`);
      } else if (salience !== null) {
        parts.push(`- ${sector}[sal:${salience}%] ${content}`);
      } else {
        parts.push(`- ${sector} ${content}`);
      }
    });
  }

  if (parts.length === 1) {
    return "";
  }

  return parts.join("\n");
}
