import { AbilityBuilder, createMongoAbility, type MongoAbility } from '@casl/ability';
import type { PrismaClient } from '@prisma/client';
import { isPermissionKey, permissionDefinition, type PermissionKey } from './permissions.js';

export interface AuthorizationGrant {
  startsAt: Date;
  expiresAt: Date | null;
  revokedAt: Date | null;
  roleEnabled: boolean;
  permissionKeys: readonly (PermissionKey | string)[];
}

export type ProtectedAdminMutation = 'delete' | 'suspend' | 'change_nickname' | 'change_grants';
export type AppAbility = MongoAbility<[string, string]>;

export interface AuthorizationContext {
  ability: AppAbility;
  permissionKeys: PermissionKey[];
  isProtectedAdmin: boolean;
  mustChangePassword: boolean;
  grants: AuthorizationGrant[];
}

export class AuthorizationError extends Error {
  readonly code: 'FORBIDDEN' | 'PROTECTED_ADMIN';

  constructor(code: 'FORBIDDEN' | 'PROTECTED_ADMIN', message: string) {
    super(message);
    this.name = 'AuthorizationError';
    this.code = code;
  }
}

export function isGrantEffective(grant: AuthorizationGrant, now = new Date()): boolean {
  return grant.roleEnabled
    && grant.revokedAt === null
    && grant.startsAt.getTime() <= now.getTime()
    && (grant.expiresAt === null || grant.expiresAt.getTime() > now.getTime());
}

export function effectivePermissionKeys(
  grants: readonly AuthorizationGrant[],
  now = new Date(),
): PermissionKey[] {
  const keys = new Set<PermissionKey>();
  for (const grant of grants) {
    if (!isGrantEffective(grant, now)) continue;
    for (const key of grant.permissionKeys) {
      if (isPermissionKey(key)) keys.add(key);
    }
  }
  return [...keys].sort();
}

export function buildAbility(permissionKeys: readonly PermissionKey[]): AppAbility {
  const { can, build } = new AbilityBuilder<AppAbility>(createMongoAbility);
  for (const key of permissionKeys) {
    const definition = permissionDefinition(key);
    can(definition.action, definition.resource);
  }
  return build();
}

export function requirePermission(permissionKeys: readonly PermissionKey[], key: PermissionKey): void {
  if (!permissionKeys.includes(key)) {
    throw new AuthorizationError('FORBIDDEN', '没有执行此操作的权限');
  }
}

export function assertProtectedAdminMutationAllowed(
  target: { protectedAdminKey: string | null },
  _mutation: ProtectedAdminMutation,
): void {
  if (target.protectedAdminKey) {
    throw new AuthorizationError('PROTECTED_ADMIN', '受保护的管理员账号不能执行此操作');
  }
}

export async function loadAuthorizationContext(
  prisma: PrismaClient,
  userId: bigint,
  now = new Date(),
): Promise<AuthorizationContext> {
  const [user, storedGrants] = await Promise.all([
    prisma.user.findUnique({
      where: { id: userId },
      select: { protectedAdminKey: true, mustChangePassword: true },
    }),
    prisma.userRoleGrant.findMany({
      where: {
        userId,
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        role: { enabled: true },
      },
      include: {
        role: {
          select: {
            enabled: true,
            permissions: {
              select: { permission: { select: { key: true } } },
            },
          },
        },
      },
    }),
  ]);

  if (!user) throw new AuthorizationError('FORBIDDEN', '用户不存在或已失效');

  const grants: AuthorizationGrant[] = storedGrants.map((grant) => ({
    startsAt: grant.startsAt,
    expiresAt: grant.expiresAt,
    revokedAt: grant.revokedAt,
    roleEnabled: grant.role.enabled,
    permissionKeys: grant.role.permissions.map((item) => item.permission.key),
  }));
  const permissionKeys = effectivePermissionKeys(grants, now);

  return {
    ability: buildAbility(permissionKeys),
    permissionKeys,
    isProtectedAdmin: user.protectedAdminKey !== null,
    mustChangePassword: user.mustChangePassword,
    grants,
  };
}
