import type { PermissionKey } from './permissions.js';

export type RealtimeScope = 'public' | 'admin' | 'private';

export interface RealtimeEvent {
  type: string;
  resourceId: string;
  scope: RealtimeScope;
  occurredAt: string;
}

export interface RealtimeSocket {
  readyState: number;
  send(payload: string): void;
  close?(code?: number, reason?: string): void;
}

interface RealtimeConnection {
  userId: bigint;
  socket: RealtimeSocket;
}

interface RealtimeHubOptions {
  loadPermissions?: (userId: bigint) => Promise<readonly string[]>;
}

export interface RealtimeHub {
  connect(input: RealtimeConnection): () => void;
  publishPublic(event: RealtimeEvent): void;
  publishPrivate(userIds: readonly bigint[], event: RealtimeEvent): void;
  publishAdmin(event: RealtimeEvent, permissionKey: PermissionKey): Promise<void>;
  connectionCount(): number;
  closeAll(): void;
}

export function createRealtimeHub(options: RealtimeHubOptions = {}): RealtimeHub {
  const connections = new Set<RealtimeConnection>();
  const loadPermissions = options.loadPermissions ?? (async () => []);

  function disconnect(connection: RealtimeConnection) {
    connections.delete(connection);
  }

  function send(connection: RealtimeConnection, event: RealtimeEvent) {
    if (connection.socket.readyState !== 1) {
      disconnect(connection);
      return;
    }
    try {
      connection.socket.send(JSON.stringify(event));
    } catch {
      disconnect(connection);
    }
  }

  return {
    connect(input) {
      const connection = { userId: input.userId, socket: input.socket };
      connections.add(connection);
      return () => disconnect(connection);
    },
    publishPublic(event) {
      for (const connection of [...connections]) send(connection, { ...event, scope: 'public' });
    },
    publishPrivate(userIds, event) {
      const targets = new Set(userIds.map((userId) => userId.toString()));
      for (const connection of [...connections]) {
        if (targets.has(connection.userId.toString())) send(connection, { ...event, scope: 'private' });
      }
    },
    async publishAdmin(event, permissionKey) {
      await Promise.all([...connections].map(async (connection) => {
        try {
          const permissions = await loadPermissions(connection.userId);
          if (permissions.includes(permissionKey)) send(connection, { ...event, scope: 'admin' });
        } catch {
          // An authorization lookup failure skips this event for the connection.
        }
      }));
    },
    connectionCount() {
      return connections.size;
    },
    closeAll() {
      for (const connection of [...connections]) {
        try { connection.socket.close?.(1001, 'server shutdown'); } catch { /* already closed */ }
        disconnect(connection);
      }
    },
  };
}
