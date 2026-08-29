export type ShopMaintenanceClient = {
  shopOrder: {
    findMany(args: unknown): Promise<Array<{ id: bigint; userId: bigint }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  shopOrderItem: { updateMany(args: unknown): Promise<{ count: number }> };
  shopProduct: {
    findMany(args: unknown): Promise<Array<{ publisherId: bigint | null }>>;
    updateMany(args: unknown): Promise<{ count: number }>;
  };
  userRoleGrant: { findMany(args: unknown): Promise<Array<{ userId?: bigint; role: { permissions: Array<{ permission: { key: string } }> } }>> };
  notification: { create(args: unknown): Promise<unknown> };
};

export async function offSalePublisherProductsIfUnauthorized(
  db: Pick<ShopMaintenanceClient, 'userRoleGrant' | 'shopProduct' | 'notification'>,
  publisherId: bigint,
  now = new Date(),
) {
  const grants = await db.userRoleGrant.findMany({
    where: {
      userId: publisherId,
      revokedAt: null,
      startsAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      role: {
        enabled: true,
        permissions: { some: { permission: { key: 'shop.product.create_own' } } },
      },
    },
    include: {
      role: { select: { permissions: { select: { permission: { select: { key: true } } } } } },
    },
  });
  const canPublish = grants.some((grant) => grant.role.permissions.some((item) => item.permission.key === 'shop.product.create_own'));
  if (canPublish) return 0;

  let changed: { count: number };
  try {
    changed = await db.shopProduct.updateMany({
      where: { publisherId, status: 'on_sale' },
      data: { status: 'off_sale' },
    });
  } catch (error) {
    // The mall is disabled in deployments without the optional shop tables.
    if ((error as { code?: string })?.code === 'P2021') return 0;
    throw error;
  }
  if (changed.count > 0) {
    await db.notification.create({
      data: {
        userId: publisherId,
        type: 'shop_publisher_permission_lost',
        payload: { offSaleProductCount: changed.count },
      },
    });
  }
  return changed.count;
}

export async function runShopMaintenance(db: ShopMaintenanceClient, now = new Date()) {
  const shippedBefore = new Date(now.getTime() - 15 * 24 * 60 * 60 * 1000);
  const expiredShipments = await db.shopOrder.findMany({
    where: { status: 'shipped', completedAt: null, shippedAt: { lte: shippedBefore } },
    select: { id: true, userId: true },
  });
  let completedOrders = 0;
  for (const order of expiredShipments) {
    const changed = await db.shopOrder.updateMany({
      where: { id: order.id, status: 'shipped', completedAt: null },
      data: { status: 'completed', completedAt: now },
    });
    if (changed.count !== 1) continue;
    completedOrders += 1;
    await db.shopOrderItem.updateMany({
      where: { orderId: order.id, fulfillmentStatus: 'pending' },
      data: { fulfillmentStatus: 'delivered' },
    });
    await db.notification.create({
      data: {
        userId: order.userId,
        type: 'shop_order_auto_completed',
        refId: order.id.toString(),
        payload: { orderId: order.id.toString() },
      },
    });
  }

  const livePublishers = await db.shopProduct.findMany({
    where: { status: 'on_sale', publisherId: { not: null } },
    distinct: ['publisherId'],
    select: { publisherId: true },
  });
  const publisherIds = livePublishers.flatMap((product) => product.publisherId === null ? [] : [product.publisherId]);
  let offSaleProducts = 0;
  if (publisherIds.length > 0) {
    const grants = await db.userRoleGrant.findMany({
      where: {
        userId: { in: publisherIds },
        revokedAt: null,
        startsAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        role: {
          enabled: true,
          permissions: { some: { permission: { key: 'shop.product.create_own' } } },
        },
      },
      select: { userId: true, role: { select: { permissions: { select: { permission: { select: { key: true } } } } } } },
    });
    const authorized = new Set(grants
      .filter((grant) => grant.role.permissions.some((item) => item.permission.key === 'shop.product.create_own'))
      .map((grant) => grant.userId?.toString())
      .filter(Boolean));
    for (const publisherId of publisherIds) {
      if (authorized.has(publisherId.toString())) continue;
      let changed: { count: number };
      try {
        changed = await db.shopProduct.updateMany({ where: { publisherId, status: 'on_sale' }, data: { status: 'off_sale' } });
      } catch (error) {
        if ((error as { code?: string })?.code === 'P2021') continue;
        throw error;
      }
      if (changed.count > 0) {
        offSaleProducts += changed.count;
        await db.notification.create({ data: { userId: publisherId, type: 'shop_publisher_permission_lost', payload: { offSaleProductCount: changed.count } } });
      }
    }
  }
  return { completedOrders, offSaleProducts };
}
