import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import { CONFIG } from "../config.js";
import type { MemoryScopeContext } from "../types/index.js";

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex").slice(0, 16);
}

export function getGitEmail(): string | null {
  try {
    const email = execSync("git config user.email", { encoding: "utf-8" }).trim();
    return email || null;
  } catch {
    return null;
  }
}

export function getUserId(): string {
  const email = getGitEmail();
  if (email) {
    return sha256(email);
  }
  const fallback = process.env.USER || process.env.USERNAME || "anonymous";
  return sha256(fallback);
}

export function getProjectId(directory: string): string {
  return sha256(directory);
}

export function getScopes(directory: string): { user: MemoryScopeContext; project: MemoryScopeContext } {
  const userId = getUserId();
  const projectId = getProjectId(directory);
  
  return {
    user: { userId },
    project: { userId, projectId },
  };
}

// Legacy tag-based functions for backward compatibility
export function getUserTag(): string {
  return `${CONFIG.scopePrefix}_user_${getUserId()}`;
}

export function getProjectTag(directory: string): string {
  return `${CONFIG.scopePrefix}_project_${getProjectId(directory)}`;
}

export function getTags(directory: string): { user: string; project: string } {
  return {
    user: getUserTag(),
    project: getProjectTag(directory),
  };
}
