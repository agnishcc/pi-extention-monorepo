import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'toolResult';
  content: string;
  thinking?: string;
  toolName?: string;
  toolCallId?: string;
  timestamp?: string;
  model?: string;
  provider?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  tools?: Array<{
    name: string;
    args?: any;
    result?: string;
  }>;
}

export interface SessionTranscript {
  sessionId: string;
  filepath: string;
  firstTurn?: string;
  lastTurn?: string;
  messages: ChatMessage[];
  modelsUsed: string[];
}

const SESSIONS_DIR = join(homedir(), '.pi', 'agent', 'sessions');

/**
 * Walk ~/.pi/agent/sessions once and return the set of session IDs that have a
 * matching JSONL transcript file. IDs are extracted from filenames of the
 * canonical form `<timestamp>_<uuid>.jsonl`. Subagent `session.jsonl` files
 * (which have no top-level session ID) are intentionally skipped — they cannot
 * be associated with a main session via filename alone.
 */
export function getAvailableSessionIds(): Set<string> {
  const ids = new Set<string>();
  if (!existsSync(SESSIONS_DIR)) return ids;

  const stack: string[] = [SESSIONS_DIR];

  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'subagent-artifacts' && !entry.name.startsWith('.')) {
            stack.push(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.jsonl') && entry.name !== 'session.jsonl') {
          // Filename pattern: `<iso-ts-with-dashes>_<uuid>.jsonl`
          const lastUnderscore = entry.name.lastIndexOf('_');
          if (lastUnderscore !== -1) {
            const id = entry.name.slice(lastUnderscore + 1, -'.jsonl'.length);
            if (id) ids.add(id);
          }
        }
      }
    } catch {
      // ignore unreadable subdirectory
    }
  }
  return ids;
}

export function getSessionFilePath(sessionId: string): string | null {
  if (!existsSync(SESSIONS_DIR)) return null;

  const stack: string[] = [SESSIONS_DIR];

  while (stack.length > 0) {
    const current = stack.pop()!;
    try {
      const entries = readdirSync(current, { withFileTypes: true });
      for (const entry of entries) {
        const fullPath = join(current, entry.name);
        if (entry.isDirectory()) {
          if (entry.name !== 'subagent-artifacts' && !entry.name.startsWith('.')) {
            stack.push(fullPath);
          }
        } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
          if (entry.name.includes(sessionId)) {
            return fullPath;
          }
        }
      }
    } catch {
      // ignore read error
    }
  }
  return null;
}

export function readSessionTranscript(sessionId: string): SessionTranscript | null {
  const filepath = getSessionFilePath(sessionId);
  if (!filepath || !existsSync(filepath)) return null;

  try {
    const content = readFileSync(filepath, 'utf-8');
    const lines = content.split('\n');

    const messages: ChatMessage[] = [];
    const modelsSet = new Set<string>();
    let currentModel: string | undefined;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      try {
        const entry = JSON.parse(line);
        const type = entry.type;

        if (type === 'model_change') {
          const provider = entry.provider;
          const modelId = entry.modelId;
          if (modelId) {
            currentModel = provider ? `${provider}/${modelId}` : modelId;
            modelsSet.add(currentModel);
          }
        } else if (type === 'message') {
          const msg = entry.message || {};
          const rawRole = msg.role || 'user';
          let text = '';
          let thinkingText = '';
          const tools: Array<{ name: string; args?: any; result?: string }> = [];

          if (typeof msg.content === 'string') {
            text = msg.content;
          } else if (Array.isArray(msg.content)) {
            for (const part of msg.content) {
              if (typeof part === 'string') {
                text += part + '\n';
              } else if (part && typeof part === 'object') {
                if (part.type === 'text' && part.text) {
                  text += part.text + '\n';
                } else if (part.type === 'thinking' && part.thinking) {
                  thinkingText += part.thinking + '\n';
                } else if (part.type === 'tool_use' || part.type === 'tool_call' || part.type === 'toolCall') {
                  tools.push({
                    name: part.name || part.function?.name || 'tool',
                    args: part.input || part.arguments || part.args,
                  });
                }
              }
            }
          }

          const role: 'user' | 'assistant' | 'system' | 'toolResult' =
            rawRole === 'assistant'
              ? 'assistant'
              : rawRole === 'system'
              ? 'system'
              : rawRole === 'toolResult'
              ? 'toolResult'
              : 'user';

          const modelUsed = msg.model ? (msg.provider ? `${msg.provider}/${msg.model}` : msg.model) : currentModel;
          if (modelUsed) modelsSet.add(modelUsed);

          messages.push({
            id: entry.id || `msg-${i}`,
            role,
            content: text.trim(),
            thinking: thinkingText.trim() || undefined,
            toolName: msg.toolName,
            toolCallId: msg.toolCallId,
            timestamp: entry.timestamp || msg.timestamp,
            model: modelUsed,
            provider: msg.provider,
            usage: msg.usage
              ? {
                  input: msg.usage.input || 0,
                  output: msg.usage.output || 0,
                  cacheRead: msg.usage.cacheRead || 0,
                  cacheWrite: msg.usage.cacheWrite || 0,
                }
              : undefined,
            tools: tools.length > 0 ? tools : undefined,
          });
        }
      } catch {
        // line parse error
      }
    }

    return {
      sessionId,
      filepath,
      firstTurn: messages.find((m) => m.timestamp)?.timestamp,
      lastTurn: [...messages].reverse().find((m) => m.timestamp)?.timestamp,
      messages,
      modelsUsed: Array.from(modelsSet),
    };
  } catch (err) {
    console.error('Error reading session transcript:', err);
    return null;
  }
}
