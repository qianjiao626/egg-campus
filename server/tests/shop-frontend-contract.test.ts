import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('shop frontend contract', () => {
  const html = readFileSync(resolve(process.cwd(), '../backend-handoff-package/growth-school.html'), 'utf8');
  const client = readFileSync(resolve(process.cwd(), '../backend-handoff-package/api-client.js'), 'utf8');

  it('provides integrated user, publisher and admin shop pages', () => {
    for (const page of ['shop', 'shop-cart', 'shop-orders', 'shop-entitlements', 'shop-addresses', 'publisher-shop', 'admin-shop']) {
      expect(html).toContain(`id="page-${page}"`);
      expect(html).toContain(`data-page="${page}"`);
    }
    for (const selector of ['shop-search', 'shop-checkout', 'shop-address-select', 'shop-order-status', 'publisher-product-create', 'publisher-submit', 'admin-shop-review', 'admin-shop-ship', 'admin-shop-refund']) {
      expect(html).toContain(`data-testid="${selector}"`);
    }
    expect(html).toContain('data-testid="publisher-product-images"');
  });

  it('keeps every shop workspace implemented but hidden behind one disabled frontend switch', () => {
    expect(html).toContain('<html lang="zh-CN" data-shop-enabled="false">');
    expect(html).toContain('var SHOP_FRONTEND_ENABLED = document.documentElement.dataset.shopEnabled === \'true\';');
    expect(html).toContain('if(!SHOP_FRONTEND_ENABLED && SHOP_PAGE_IDS.indexOf(id) >= 0)');
    expect(html).toContain('SHOP_FRONTEND_ENABLED && permissionKeys.some');

    for (const page of ['shop', 'shop-cart', 'shop-orders', 'shop-entitlements', 'shop-addresses', 'publisher-shop', 'admin-shop']) {
      expect(html).toContain(`data-page="${page}" data-shop-ui`);
      expect(html).toContain(`id="page-${page}" data-shop-ui`);
    }
  });

  it('uses the shared API client for all shop workspaces', () => {
    for (const method of ['shopProducts', 'shopCart', 'createShopOrder', 'shopOrders', 'shopEntitlements', 'publisherShopProducts', 'adminShopProducts', 'shipAdminShopOrder', 'refundAdminShopOrder']) {
      expect(client).toContain(`${method}: function`);
      expect(html).toContain(`apiClient.${method}`);
    }
    expect(client).not.toMatch(/localStorage.*(?:address|redeem|token)/i);
  });

  it('uploads validated shop images and resolves their API URLs for both local and production use', () => {
    expect(client).toContain('uploadShopImages: function');
    expect(client).toContain('resolveShopAssetUrl: function');
    expect(html).toContain('apiClient.uploadShopImages');
    expect(html).toContain('apiClient.resolveShopAssetUrl');
  });
});
