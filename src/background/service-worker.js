/**
 * MusicMutePro — Service Worker (MV3 background)
 * -----------------------------------------------
 * Responsibilities:
 *   - Initialize default settings on install
 *   - Update the action badge per-tab to reflect attached media count
 *   - Forward state changes to all open tabs when settings change
 *   - Open the options page on first install
 */

const DEFAULTS = {
  enabled: true,
  mode: 'karaoke',
  intensity: 0.85,
  speechBoost: 1.0,
  preserveBass: false,
  highCut: 4500,
  lowCut: 180,
  perSiteOverrides: {}
};

chrome.runtime.onInstalled.addListener(async (details) => {
  // Seed defaults without overwriting user settings on update
  const current = await chrome.storage.sync.get();
  const merged = { ...DEFAULTS, ...current };
  await chrome.storage.sync.set(merged);

  if (details.reason === 'install') {
    chrome.runtime.openOptionsPage?.();
  }
});

// When settings change, broadcast to all tabs so the page-engine refreshes.
chrome.storage.onChanged.addListener(async (_changes, area) => {
  if (area !== 'sync') return;
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id) continue;
    chrome.tabs.sendMessage(tab.id, { type: 'STATE_CHANGED' }).catch(() => {
      // Tab probably doesn't have the content script (e.g. chrome://)
    });
  }
});

// Update badge on tab activation / update
async function updateBadge(tabId) {
  try {
    const status = await chrome.tabs.sendMessage(tabId, { type: 'GET_STATUS' });
    const count = status?.attachedCount ?? 0;
    const text = count > 0 ? String(count) : '';
    chrome.action.setBadgeText({ tabId, text });
    chrome.action.setBadgeBackgroundColor({ tabId, color: '#10b981' });
  } catch {
    chrome.action.setBadgeText({ tabId, text: '' });
  }
}

chrome.tabs.onActivated.addListener(({ tabId }) => updateBadge(tabId));
chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === 'complete') updateBadge(tabId);
});

// Periodic poll for badge accuracy on long-lived tabs
chrome.alarms?.create?.('badge-refresh', { periodInMinutes: 1 });
chrome.alarms?.onAlarm.addListener(async (alarm) => {
  if (alarm.name !== 'badge-refresh') return;
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (active?.id) updateBadge(active.id);
});
