import { describe, expect, it } from 'vitest';
import {
  assertProtectedAdminMutationAllowed,
  effectivePermissionKeys,
  isGrantEffective,
  loadAuthorizationContext,
  type AuthorizationGrant,
} from '../src/authorization.js';
import { PERMISSION_KEYS, permissionDefinition } from '../src/permissions.js';

const now = new Date('2026-08-26T12:00:00.000Z');

function grant(overrides: Partial<AuthorizationGrant> = {}): AuthorizationGrant {
  return {
    startsAt: new Date('2026-08-26T11:00:00.000Z'),
    expiresAt: new Date('2026-08-26T13:00:00.000Z'),
    revokedAt: null,
    roleEnabled: true,
    permissionKeys: [PERMISSION_KEYS.taskReview],
    ...overrides,
  };
}

describe('authorization rules', () => {
  it('accepts active and permanent grants using server time', () => {
    expect(isGrantEffective(grant(), now)).toBe(true);
    expect(isGrantEffective(grant({ expiresAt: null }), now)).toBe(true);
  });

  it('rejects future, expired, revoked, and disabled grants', () => {
    expect(isGrantEffective(grant({ startsAt: new Date('2026-08-26T12:00:01.000Z') }), now)).toBe(false);
    expect(isGrantEffective(grant({ expiresAt: now }), now)).toBe(false);
    expect(isGrantEffective(grant({ revokedAt: new Date('2026-08-26T11:30:00.000Z') }), now)).toBe(false);
    expect(isGrantEffective(grant({ roleEnabled: false }), now)).toBe(false);
  });

  it('unions permissions from every effective role without duplicates', () => {
    const keys = effectivePermissionKeys([
      grant({ permissionKeys: [PERMISSION_KEYS.taskReview, PERMISSION_KEYS.feedbackView] }),
      grant({ permissionKeys: [PERMISSION_KEYS.feedbackView, PERMISSION_KEYS.feedbackReply] }),
      grant({ expiresAt: now, permissionKeys: [PERMISSION_KEYS.permissionRoleGrant] }),
    ], now);

    expect(keys).toEqual([
      PERMISSION_KEYS.feedbackReply,
      PERMISSION_KEYS.feedbackView,
      PERMISSION_KEYS.taskReview,
    ].sort());
  });

  it('keeps permission-management capabilities protected', () => {
    expect(permissionDefinition(PERMISSION_KEYS.permissionRoleGrant).protected).toBe(true);
    expect(permissionDefinition(PERMISSION_KEYS.shopProductReview).protected).toBe(false);
  });

  it('blocks protected administrator identity and account mutations', () => {
    for (const mutation of ['delete', 'suspend', 'change_nickname', 'change_grants'] as const) {
      try {
        assertProtectedAdminMutationAllowed({ protectedAdminKey: 'fixed-admin-1' }, mutation);
        throw new Error('expected protected administrator mutation to fail');
      } catch (error) {
        expect(error).toMatchObject({ code: 'PROTECTED_ADMIN' });
      }
    }
    expect(() => assertProtectedAdminMutationAllowed({ protectedAdminKey: null }, 'suspend')).not.toThrow();
  });

  it('loads only effective stored grants and builds an ability', async () => {
    const prisma = {
      user: {
        findUnique: async () => ({ protectedAdminKey: 'fixed-admin-1', mustChangePassword: true }),
      },
      userRoleGrant: {
        findMany: async () => [{
          startsAt: new Date('2026-08-26T11:00:00.000Z'),
          expiresAt: null,
          revokedAt: null,
          role: {
            enabled: true,
            permissions: [
              { permission: { key: PERMISSION_KEYS.taskReview } },
              { permission: { key: PERMISSION_KEYS.feedbackReply } },
            ],
          },
        }],
      },
    };

    const context = await loadAuthorizationContext(prisma as never, 1n, now);

    expect(context.permissionKeys).toEqual([PERMISSION_KEYS.feedbackReply, PERMISSION_KEYS.taskReview].sort());
    expect(context.ability.can('review', 'task')).toBe(true);
    expect(context.ability.can('reply', 'feedback')).toBe(true);
    expect(context.ability.can('grant', 'permission')).toBe(false);
    expect(context.isProtectedAdmin).toBe(true);
    expect(context.mustChangePassword).toBe(true);
  });
});
