import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const packageRoot = resolve(process.cwd(), '..', 'backend-handoff-package');
const host = readFileSync(resolve(packageRoot, 'growth-school.html'), 'utf8');
const buddy = readFileSync(resolve(packageRoot, 'blind-box', 'app.js'), 'utf8');
const client = readFileSync(resolve(packageRoot, 'api-client.js'), 'utf8');

describe('frontend performance contract', () => {
  it('defers the blind-box document until its page is opened', () => {
    expect(host).toContain('src="about:blank" data-src="blind-box/"');
    expect(host).toContain("type:'dandan-buddy-activity', active:false");
    expect(host).toContain("type:'dandan-buddy-activity', active:true");
  });

  it('pauses blind-box polling outside an active visible page and deduplicates requests', () => {
    expect(buddy).toContain('function canPollBuddy()');
    expect(buddy).toContain("document.addEventListener('visibilitychange', updateBuddyPolling)");
    expect(buddy).toContain('if (inboxSyncPromise) return inboxSyncPromise;');
    expect(buddy).toContain('if (conversationSyncPromise) return conversationSyncPromise;');
    expect(buddy).toContain("if (conversationProfile && conversationOverlay.classList.contains('open')) refreshConversation();");
  });

  it('keeps heavy profile and inquiry reply requests on demand', () => {
    expect(host).toContain('function refreshProfileDetails()');
    expect(host).toContain("if(id === 'profile'){ refreshProfileDetails();");
    expect(host).toContain('mappedPost.repliesLoaded = false;');
    expect(host).toContain("window.apiClient.inquiryReplies(post.serverId || post.id)");
    expect(host).toContain('if(publicTaskPlazaSyncPromise) return publicTaskPlazaSyncPromise;');
    expect(client).toContain('if (hydrateUserPromise) return hydrateUserPromise;');
  });
});
