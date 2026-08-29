import type { PrismaClient } from '@prisma/client';
import { PERMISSIONS, PERMISSION_KEYS } from './permissions.js';

export const FIXED_ADMIN_ROLE_CODE = 'fixed_administrator';
export const PRODUCT_PUBLISHER_ROLE_CODE = 'product_publisher';

const publisherPermissionKeys = [
  PERMISSION_KEYS.shopProductCreateOwn,
  PERMISSION_KEYS.shopProductEditOwn,
  PERMISSION_KEYS.shopProductSubmitOwn,
  PERMISSION_KEYS.shopProductStatsOwn,
];

export async function seedAuthorizationCatalog(prisma: PrismaClient): Promise<void> {
  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: { key: permission.key },
      create: permission,
      update: {
        resource: permission.resource,
        action: permission.action,
        description: permission.description,
        risk: permission.risk,
        protected: permission.protected,
      },
    });
  }

  const fixedRole = await prisma.role.upsert({
    where: { code: FIXED_ADMIN_ROLE_CODE },
    create: { code: FIXED_ADMIN_ROLE_CODE, name: '管理员', description: '受保护的固定管理员完整权限', enabled: true, systemProtected: true },
    update: { name: '管理员', description: '受保护的固定管理员完整权限', enabled: true, systemProtected: true },
  });
  const publisherRole = await prisma.role.upsert({
    where: { code: PRODUCT_PUBLISHER_ROLE_CODE },
    create: { code: PRODUCT_PUBLISHER_ROLE_CODE, name: '商品发布者', description: '创建、编辑、提交和查看自有商品数据', enabled: true },
    update: { name: '商品发布者', description: '创建、编辑、提交和查看自有商品数据' },
  });
  const storedPermissions = await prisma.permission.findMany({ select: { id: true, key: true } });
  const permissionIdByKey = new Map(storedPermissions.map((permission) => [permission.key, permission.id]));
  const fixedRolePermissions = PERMISSIONS.map((permission) => ({ roleId: fixedRole.id, permissionId: permissionIdByKey.get(permission.key)! }));
  const publisherRolePermissions = publisherPermissionKeys.map((key) => ({ roleId: publisherRole.id, permissionId: permissionIdByKey.get(key)! }));

  await prisma.$transaction(async (tx) => {
    await tx.rolePermission.deleteMany({ where: { roleId: { in: [fixedRole.id, publisherRole.id] } } });
    await tx.rolePermission.createMany({ data: [...fixedRolePermissions, ...publisherRolePermissions] });
  });

  const protectedUsers = await prisma.user.findMany({
    where: { protectedAdminKey: { not: null } },
    select: { id: true },
  });
  for (const user of protectedUsers) {
    await prisma.$transaction(async (tx) => {
      const existing = await tx.userRoleGrant.findFirst({
        where: { userId: user.id, roleId: fixedRole.id },
        orderBy: { createdAt: 'desc' },
      });
      const grant = existing
        ? await tx.userRoleGrant.update({
            where: { id: existing.id },
            data: { startsAt: new Date(), expiresAt: null, isPermanent: true, revokedAt: null, revokedBy: null, revokeReason: null },
          })
        : await tx.userRoleGrant.create({ data: { userId: user.id, roleId: fixedRole.id, startsAt: new Date(), expiresAt: null, isPermanent: true } });
      await tx.roleGrantAudit.create({
        data: {
          grantId: grant.id,
          action: existing ? 'seed_restore' : 'seed_grant',
          afterData: { roleCode: FIXED_ADMIN_ROLE_CODE, isPermanent: true },
          reason: 'protected administrator catalog seed',
        },
      });
    });
  }
}
