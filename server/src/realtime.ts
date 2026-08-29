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
  permissionCacheTtlMs?: number;
}

export interface RealtimeHub {
  connect(input: RealtimeConnection): () => void;
  publishPublic(event: RealtimeEvent): void;
  publishPrivate(userIds: readonly bigint[], event: RealtimeEvent): void;
  publishAdmin(event: RealtimeEvent, permissionKey: PermissionKey): Promise<void>;
  invalidatePermissions(userIds?: readonly bigint[]): void;
  connectionCount(): number;
  closeAll(): void;
}

export function createRealtimeHub(options: RealtimeHubOptions = {}): RealtimeHub {
  const connectionsByUser = new Map<bigint, Set<RealtimeConnection>>();
  const loadPermissions = options.loadPermissions ?? (async () => []);
  const permissionCacheTtlMs = options.permissionCacheTtlMs ?? 1_000;
  const permissionCache = new Map<bigint, { permissions: readonly string[]; expiresAt: number; globalGeneration: number; userGeneration: number }>();
  const permissionLoads = new Map<bigint, Promise<readonly string[]>>();
  const userGenerations = new Map<bigint, number>();
  let globalGeneration = 0;
  let connectionCount = 0;

  function userGeneration(userId: bigint) {
    return userGenerations.get(userId) ?? 0;
  }

  function clearUserPermissions(userId: bigint) {
    permissionCache.delete(userId);
    permissionLoads.delete(userId);
    userGenerations.set(userId, userGeneration(userId) + 1);
  }

  function permissionsFor(userId: bigint) {
    const now = Date.now();
    const cached = permissionCache.get(userId);
    if (cached
      && cached.expiresAt > now
      && cached.globalGeneration === globalGeneration
      && cached.userGeneration === userGeneration(userId)) return Promise.resolve(cached.permissions);
    const existing = permissionLoads.get(userId);
    if (existing) return existing;
    const loadGlobalGeneration = globalGeneration;
    const loadUserGeneration = userGeneration(userId);
    const loading = loadPermissions(userId).then((permissions) => {
      if (globalGeneration === loadGlobalGeneration && userGeneration(userId) === loadUserGeneration && connectionsByUser.has(userId)) {
        permissionCache.set(userId, {
          permissions,
          expiresAt: Date.now() + permissionCacheTtlMs,
          globalGeneration: loadGlobalGeneration,
          userGeneration: loadUserGeneration,
        });
      }
      return permissions;
    }).finally(() => {
      if (permissionLoads.get(userId) === loading) permissionLoads.delete(userId);
    });
    permissionLoads.set(userId, loading);
    return loading;
  }

  function disconnect(connection: RealtimeConnection) {
    const userConnections = connectionsByUser.get(connection.userId);
    if (!userConnections?.delete(connection)) return;
    connectionCount -= 1;
    if (userConnections.size === 0) {
      connectionsByUser.delete(connection.userId);
      clearUserPermissions(connection.userId);
    }
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
      const userConnections = connectionsByUser.get(input.userId) ?? new Set<RealtimeConnection>();
      userConnections.add(connection);
      connectionsByUser.set(input.userId, userConnections);
      connectionCount += 1;
      return () => disconnect(connection);
    },
    publishPublic(event) {
      for (const userConnections of [...connectionsByUser.values()]) {
        for (const connection of [...userConnections]) send(connection, { ...event, scope: 'public' });
      }
    },
    publishPrivate(userIds, event) {
      for (const userId of new Set(userIds)) {
        const userConnections = connectionsByUser.get(userId);
        if (!userConnections) continue;
        for (const connection of [...userConnections]) send(connection, { ...event, scope: 'private' });
      }
    },
    async publishAdmin(event, permissionKey) {
      await Promise.all([...connectionsByUser.entries()].map(async ([userId, userConnections]) => {
        try {
          const eventGlobalGeneration = globalGeneration;
          const eventUserGeneration = userGeneration(userId);
          const permissions = await permissionsFor(userId);
          if (eventGlobalGeneration === globalGeneration
            && eventUserGeneration === userGeneration(userId)
            && permissions.includes(permissionKey)) {
            for (const connection of [...userConnections]) send(connection, { ...event, scope: 'admin' });
          }
        } catch {
          // An authorization lookup failure skips this event and is retried next time.
        }
      }));
    },
    invalidatePermissions(userIds) {
      if (userIds === undefined) {
        globalGeneration += 1;
        permissionCache.clear();
        permissionLoads.clear();
        return;
      }
      for (const userId of new Set(userIds)) clearUserPermissions(userId);
    },
    connectionCount() {
      return connectionCount;
    },
    closeAll() {
      for (const userConnections of [...connectionsByUser.values()]) {
        for (const connection of [...userConnections]) {
          try { connection.socket.close?.(1001, 'server shutdown'); } catch { /* already closed */ }
        }
      }
      connectionsByUser.clear();
      connectionCount = 0;
      globalGeneration += 1;
      permissionCache.clear();
      permissionLoads.clear();
      userGenerations.clear();
    },
  };
}
