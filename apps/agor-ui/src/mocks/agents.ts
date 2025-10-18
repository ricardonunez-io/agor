// src/mocks/agents.ts
import type { Agent, AgentID } from '../types';

export const mockAgentClaudecode: Agent = {
  id: 'claude-code' as AgentID,
  name: 'claude-code',
  icon: '🤖',
  installed: true,
  version: '1.2.3',
  description:
    'Anthropic Claude Code - AI-powered coding assistant with deep codebase understanding',
  installable: true,
};

export const mockAgentCodex: Agent = {
  id: 'codex' as AgentID,
  name: 'codex',
  icon: '💻',
  installed: true,
  version: '0.46.0',
  description: 'OpenAI Codex - GPT-5 powered software engineering agent with streaming support',
  installable: true,
};

export const mockAgentCursor: Agent = {
  id: 'cursor' as AgentID,
  name: 'cursor',
  icon: '✏️',
  installed: false,
  description: 'Cursor AI - Intelligent code editor with AI pair programming (Coming Soon)',
  installable: false,
};

export const mockAgentGemini: Agent = {
  id: 'gemini' as AgentID,
  name: 'gemini',
  icon: '💎',
  installed: true,
  version: '0.9.0',
  description: 'Google Gemini - Fast, cost-effective coding agent with multimodal capabilities',
  installable: true,
};

export const mockAgents: Agent[] = [
  mockAgentClaudecode,
  mockAgentCodex,
  mockAgentGemini, // Position 3 - promoted!
  mockAgentCursor,
];

export const mockInstalledAgents = mockAgents.filter(agent => agent.installed);
export const mockNotInstalledAgents = mockAgents.filter(agent => !agent.installed);
