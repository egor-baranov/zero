import { app } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MOCK_AGENT_FILENAME = 'zeroade-mock-acp-agent.mjs';

const buildMockAgentSource = (acpModuleUrl: string): string => String.raw`#!/usr/bin/env node
import { randomUUID } from 'node:crypto';
import { Readable, Writable } from 'node:stream';
import { AgentSideConnection, PROTOCOL_VERSION, ndJsonStream } from '${acpModuleUrl}';

class MockAcpAgent {
  constructor(connection) {
    this.connection = connection;
    this.sessions = new Map();
  }

  async initialize() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      agentInfo: {
        name: 'Zero Mock Agent',
        version: '0.1.0',
      },
      agentCapabilities: {
        loadSession: true,
      },
    };
  }

  async newSession() {
    const sessionId = randomUUID();
    this.sessions.set(sessionId, {
      history: [],
      pendingPrompt: null,
    });

    return { sessionId };
  }

  async loadSession(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      this.sessions.set(params.sessionId, {
        history: [],
        pendingPrompt: null,
      });
      return {};
    }

    for (const message of session.history) {
      await this.connection.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: message.role === 'user' ? 'user_message_chunk' : 'agent_message_chunk',
          content: {
            type: 'text',
            text: message.text,
          },
        },
      });
    }

    return {};
  }

  async authenticate() {
    return {};
  }

  async setSessionMode() {
    return {};
  }

  async prompt(params) {
    const session = this.sessions.get(params.sessionId);
    if (!session) {
      throw new Error('Session not found');
    }

    const userText = params.prompt
      .filter((item) => item.type === 'text')
      .map((item) => item.text)
      .join(' ')
      .trim();

    if (userText.length > 0) {
      session.history.push({ role: 'user', text: userText });
    }

    session.pendingPrompt?.abort();
    const controller = new AbortController();
    session.pendingPrompt = controller;

    try {
      await this.simulateTurn(params.sessionId, userText, controller.signal);
      session.pendingPrompt = null;
      return { stopReason: 'end_turn' };
    } catch (error) {
      if (controller.signal.aborted) {
        return { stopReason: 'cancelled' };
      }

      throw error;
    }
  }

  async cancel(params) {
    const session = this.sessions.get(params.sessionId);
    session?.pendingPrompt?.abort();
  }

  async simulateTurn(sessionId, userText, signal) {
    const addAgentMessage = async (text) => {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'agent_message_chunk',
          content: {
            type: 'text',
            text,
          },
        },
      });

      const session = this.sessions.get(sessionId);
      if (session) {
        session.history.push({ role: 'assistant', text });
      }
    };

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'plan',
        entries: [
          { content: 'Analyze user request', priority: 'high', status: 'completed' },
          { content: 'Inspect relevant files', priority: 'medium', status: 'in_progress' },
          { content: 'Apply and explain updates', priority: 'medium', status: 'pending' },
        ],
      },
    });

    await this.delay(signal, 450);

    await addAgentMessage(
      userText
        ? 'I received your request and I am inspecting the project structure now.'
        : 'I am ready. Tell me what you want to build next.',
    );

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'read-workspace',
        title: 'Read workspace files',
        kind: 'read',
        status: 'in_progress',
        locations: [{ path: '/workspace/README.md' }],
        rawInput: { path: '/workspace/README.md' },
      },
    });

    await this.delay(signal, 550);

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'read-workspace',
        status: 'completed',
        rawOutput: { lines: 42, summary: 'Workspace context loaded.' },
      },
    });

    await this.delay(signal, 400);

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'tool_call',
        toolCallId: 'edit-config',
        title: 'Update project configuration',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: '/workspace/config.json' }],
        rawInput: { patch: 'Set shell fidelity mode to locked' },
      },
    });

    const permission = await this.connection.requestPermission({
      sessionId,
      toolCall: {
        toolCallId: 'edit-config',
        title: 'Update project configuration',
        kind: 'edit',
        status: 'pending',
        locations: [{ path: '/workspace/config.json' }],
      },
      options: [
        { optionId: 'allow', name: 'Allow once', kind: 'allow_once' },
        { optionId: 'reject', name: 'Reject', kind: 'reject_once' },
      ],
    });

    if (permission.outcome.outcome === 'cancelled') {
      await addAgentMessage('Permission flow was cancelled. I stopped the turn.');
      return;
    }

    if (permission.outcome.optionId === 'allow') {
      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'tool_call_update',
          toolCallId: 'edit-config',
          status: 'completed',
          rawOutput: { success: true },
        },
      });

      await this.connection.sessionUpdate({
        sessionId,
        update: {
          sessionUpdate: 'plan',
          entries: [
            { content: 'Analyze user request', priority: 'high', status: 'completed' },
            { content: 'Inspect relevant files', priority: 'medium', status: 'completed' },
            { content: 'Apply and explain updates', priority: 'medium', status: 'completed' },
          ],
        },
      });

      await this.delay(signal, 380);
      await addAgentMessage('Done. I completed the config update and captured the result.');
      return;
    }

    await this.connection.sessionUpdate({
      sessionId,
      update: {
        sessionUpdate: 'tool_call_update',
        toolCallId: 'edit-config',
        status: 'failed',
        rawOutput: { success: false, reason: 'User rejected permission' },
      },
    });

    await addAgentMessage('Understood. I skipped the configuration change.');
  }

  async delay(signal, ms) {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        cleanup();
        resolve();
      }, ms);

      const onAbort = () => {
        cleanup();
        reject(new Error('aborted'));
      };

      const cleanup = () => {
        clearTimeout(timer);
        signal.removeEventListener('abort', onAbort);
      };

      signal.addEventListener('abort', onAbort);
    });
  }
}

const output = Writable.toWeb(process.stdout);
const input = Readable.toWeb(process.stdin);
const stream = ndJsonStream(output, input);
new AgentSideConnection((conn) => new MockAcpAgent(conn), stream);
`;

export const ensureMockAgentScript = async (): Promise<string> => {
  const scriptPath = path.join(app.getPath('userData'), MOCK_AGENT_FILENAME);
  let resolvedAcpEntry: string;

  try {
    resolvedAcpEntry = require.resolve('@agentclientprotocol/sdk/dist/acp.js');
  } catch {
    throw new Error('Cannot resolve ACP SDK runtime for mock agent');
  }

  if (resolvedAcpEntry.includes('.asar')) {
    throw new Error('Mock ACP agent is unavailable in packaged mode');
  }

  const acpModuleUrl = pathToFileURL(resolvedAcpEntry).href;
  const mockAgentSource = buildMockAgentSource(acpModuleUrl);

  await fs.writeFile(scriptPath, mockAgentSource, {
    encoding: 'utf8',
    mode: 0o755,
  });

  return scriptPath;
};
