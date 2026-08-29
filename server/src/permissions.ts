export const PERMISSION_KEYS = {
  userList: 'user.list',
  userView: 'user.view',
  userProfileEdit: 'user.profile.edit',
  userSuspend: 'user.suspend',
  userRestore: 'user.restore',
  taskView: 'task.view',
  taskPublish: 'task.publish',
  taskReview: 'task.review',
  taskEdit: 'task.edit',
  taskUnpublish: 'task.unpublish',
  taskClaimManage: 'task.claim.manage',
  taskAppealManage: 'task.appeal.manage',
  inquiryView: 'inquiry.view',
  inquiryHide: 'inquiry.hide',
  inquiryRefund: 'inquiry.refund',
  feedbackView: 'feedback.view',
  feedbackReply: 'feedback.reply',
  feedbackStatusUpdate: 'feedback.status.update',
  feedbackNeedsChanges: 'feedback.needs_changes',
  feedbackAttachmentView: 'feedback.attachment.view',
  feedbackAttachmentHide: 'feedback.attachment.hide',
  buddyReportHandle: 'buddy.report.handle',
  pointsLedgerView: 'points.ledger.view',
  pointsAdjust: 'points.adjust',
  pointsRefund: 'points.refund',
  contentFilterManage: 'content.filter.manage',
  contentAnnouncementManage: 'content.announcement.manage',
  contentDemoManage: 'content.demo.manage',
  blacklistCommentModerate: 'blacklist.comment.moderate',
  auditView: 'audit.view',
  auditExport: 'audit.export',
  permissionRoleCreate: 'permission.role.create',
  permissionRoleEdit: 'permission.role.edit',
  permissionRoleGrant: 'permission.role.grant',
  permissionRoleDuration: 'permission.role.duration',
  permissionRoleRevoke: 'permission.role.revoke',
  shopProductCreateOwn: 'shop.product.create_own',
  shopProductEditOwn: 'shop.product.edit_own',
  shopProductSubmitOwn: 'shop.product.submit_own',
  shopProductStatsOwn: 'shop.product.stats_own',
  shopProductViewAll: 'shop.product.view_all',
  shopProductReview: 'shop.product.review',
  shopProductPublish: 'shop.product.publish',
  shopProductArchive: 'shop.product.archive',
  shopCategoryManage: 'shop.category.manage',
  shopInventoryManage: 'shop.inventory.manage',
  shopRedeemCodeManage: 'shop.redeem_code.manage',
  shopOrderView: 'shop.order.view',
  shopOrderShip: 'shop.order.ship',
  shopOrderRefund: 'shop.order.refund',
  shopReviewModerate: 'shop.review.moderate',
  shopAuditView: 'shop.audit.view',
  shopMaintenanceRun: 'shop.maintenance.run',
} as const;

export type PermissionKey = typeof PERMISSION_KEYS[keyof typeof PERMISSION_KEYS];
export type PermissionRisk = 'normal' | 'high';

export interface PermissionDefinition {
  key: PermissionKey;
  resource: string;
  action: string;
  description: string;
  risk: PermissionRisk;
  protected: boolean;
}

const protectedPermissionKeys = new Set<PermissionKey>([
  PERMISSION_KEYS.permissionRoleCreate,
  PERMISSION_KEYS.permissionRoleEdit,
  PERMISSION_KEYS.permissionRoleGrant,
  PERMISSION_KEYS.permissionRoleDuration,
  PERMISSION_KEYS.permissionRoleRevoke,
]);

const highRiskPermissionKeys = new Set<PermissionKey>([
  ...protectedPermissionKeys,
  PERMISSION_KEYS.userSuspend,
  PERMISSION_KEYS.pointsAdjust,
  PERMISSION_KEYS.pointsRefund,
  PERMISSION_KEYS.auditExport,
  PERMISSION_KEYS.shopOrderRefund,
  PERMISSION_KEYS.shopMaintenanceRun,
]);

const descriptions: Record<PermissionKey, string> = {
  [PERMISSION_KEYS.userList]: '查看用户列表',
  [PERMISSION_KEYS.userView]: '查看用户详情',
  [PERMISSION_KEYS.userProfileEdit]: '编辑其他用户资料',
  [PERMISSION_KEYS.userSuspend]: '冻结用户账号',
  [PERMISSION_KEYS.userRestore]: '恢复用户账号',
  [PERMISSION_KEYS.taskView]: '查看全部任务',
  [PERMISSION_KEYS.taskPublish]: '代为发布任务',
  [PERMISSION_KEYS.taskReview]: '审核任务',
  [PERMISSION_KEYS.taskEdit]: '修改任务',
  [PERMISSION_KEYS.taskUnpublish]: '下架任务',
  [PERMISSION_KEYS.taskClaimManage]: '处理任务认领',
  [PERMISSION_KEYS.taskAppealManage]: '处理任务申诉',
  [PERMISSION_KEYS.inquiryView]: '查看全部打听',
  [PERMISSION_KEYS.inquiryHide]: '隐藏打听内容',
  [PERMISSION_KEYS.inquiryRefund]: '处理打听退款',
  [PERMISSION_KEYS.feedbackView]: '查看用户反馈',
  [PERMISSION_KEYS.feedbackReply]: '回复用户反馈',
  [PERMISSION_KEYS.feedbackStatusUpdate]: '修改反馈状态',
  [PERMISSION_KEYS.feedbackNeedsChanges]: '将反馈标记为待修改',
  [PERMISSION_KEYS.feedbackAttachmentView]: '查看反馈附件',
  [PERMISSION_KEYS.feedbackAttachmentHide]: '隐藏违规反馈附件',
  [PERMISSION_KEYS.buddyReportHandle]: '处理盲盒聊天举报并查看有限上下文',
  [PERMISSION_KEYS.pointsLedgerView]: '查看蛋蛋币流水',
  [PERMISSION_KEYS.pointsAdjust]: '调整用户蛋蛋币余额',
  [PERMISSION_KEYS.pointsRefund]: '处理蛋蛋币退款',
  [PERMISSION_KEYS.contentFilterManage]: '管理敏感词规则',
  [PERMISSION_KEYS.contentAnnouncementManage]: '管理公告',
  [PERMISSION_KEYS.contentDemoManage]: '管理带 demo 标签的测试数据',
  [PERMISSION_KEYS.blacklistCommentModerate]: '软删除大学吐槽内容',
  [PERMISSION_KEYS.auditView]: '查看审计记录',
  [PERMISSION_KEYS.auditExport]: '导出审计记录',
  [PERMISSION_KEYS.permissionRoleCreate]: '创建自定义角色，仅固定管理员可用',
  [PERMISSION_KEYS.permissionRoleEdit]: '编辑或停用角色，仅固定管理员可用',
  [PERMISSION_KEYS.permissionRoleGrant]: '授予角色，仅固定管理员可用',
  [PERMISSION_KEYS.permissionRoleDuration]: '设置授权期限，仅固定管理员可用',
  [PERMISSION_KEYS.permissionRoleRevoke]: '撤销角色，仅固定管理员可用',
  [PERMISSION_KEYS.shopProductCreateOwn]: '创建自己的商城商品',
  [PERMISSION_KEYS.shopProductEditOwn]: '编辑自己的商城商品',
  [PERMISSION_KEYS.shopProductSubmitOwn]: '提交自己的商品审核',
  [PERMISSION_KEYS.shopProductStatsOwn]: '查看自己商品的经营数据',
  [PERMISSION_KEYS.shopProductViewAll]: '查看全部商品及内部状态',
  [PERMISSION_KEYS.shopProductReview]: '审核商城商品',
  [PERMISSION_KEYS.shopProductPublish]: '上架或下架商城商品',
  [PERMISSION_KEYS.shopProductArchive]: '归档商城商品',
  [PERMISSION_KEYS.shopCategoryManage]: '管理商城分类',
  [PERMISSION_KEYS.shopInventoryManage]: '管理商城库存',
  [PERMISSION_KEYS.shopRedeemCodeManage]: '管理虚拟商品兑换码',
  [PERMISSION_KEYS.shopOrderView]: '查看商城订单',
  [PERMISSION_KEYS.shopOrderShip]: '处理实物订单发货',
  [PERMISSION_KEYS.shopOrderRefund]: '处理商城订单退款',
  [PERMISSION_KEYS.shopReviewModerate]: '隐藏违规商品评价',
  [PERMISSION_KEYS.shopAuditView]: '查看商城操作日志',
  [PERMISSION_KEYS.shopMaintenanceRun]: '执行商城订单完成与发布权限清理',
};

function parts(key: PermissionKey) {
  const [resource, ...actionParts] = key.split('.');
  return { resource, action: actionParts.join('.') };
}

export const PERMISSIONS: readonly PermissionDefinition[] = Object.values(PERMISSION_KEYS).map((key) => {
  const { resource, action } = parts(key);
  return {
    key,
    resource,
    action,
    description: descriptions[key],
    risk: highRiskPermissionKeys.has(key) ? 'high' : 'normal',
    protected: protectedPermissionKeys.has(key),
  };
});

const permissionByKey = new Map(PERMISSIONS.map((permission) => [permission.key, permission]));

export function isPermissionKey(value: string): value is PermissionKey {
  return permissionByKey.has(value as PermissionKey);
}

export function permissionDefinition(key: PermissionKey): PermissionDefinition {
  const definition = permissionByKey.get(key);
  if (!definition) throw new Error(`Unknown permission: ${key}`);
  return definition;
}

const nonAdministrativePermissionKeys = new Set<PermissionKey>([
  PERMISSION_KEYS.shopProductCreateOwn,
  PERMISSION_KEYS.shopProductEditOwn,
  PERMISSION_KEYS.shopProductSubmitOwn,
  PERMISSION_KEYS.shopProductStatsOwn,
]);

export function hasAdministrativePermission(keys: readonly PermissionKey[]): boolean {
  return keys.some((key) => !nonAdministrativePermissionKeys.has(key));
}
