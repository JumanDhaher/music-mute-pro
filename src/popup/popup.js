const $ = (sel) => document.querySelector(sel);
const els = { enabled: $('#enabled'), modeButtons: document.querySelectorAll('.seg-btn'), intensity: $('#intensity'), intensityValue: $('#intensityValue'), speechBoost: $('#speechBoost'), speechBoostValue: $('#speechBoostValue'), preserveBass: $('#preserveBass'), siteOverride: $('#siteOverride'), openOptions: $('#openOptions'), host: $('#host'), status: $('#status'), statusText: $('#statusText') };
const DEFAULTS = { enabled: true, mode: 'karaoke', intensity: 0.85, speechBoost: 1.0, preserveBass: false, perSiteOverrides: {} };
let activeTab = null, activeHost = null, state = { ...DEFAULTS };
function applyI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  document.documentElement.dir = ['ar','he','fa'].includes(document.documentElement.lang) ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => { const m = chrome.i18n.getMessage(el.getAttribute('data-i18n')); if (m) el.textContent = m; });
}
async function init() {
  applyI18n();
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  activeTab = tab;
  if (tab?.url) { try { activeHost = new URL(tab.url).host; els.host.textContent = activeHost || tab.url; } catch {} }
  state = await chrome.storage.sync.get(DEFAULTS);
  const so = state.perSiteOverrides?.[activeHost];
  els.siteOverride.checked = !!so;
  if (so) Object.assign(state, so);
  renderUI();
  await refreshStatus();
  attachHandlers();
}
function renderUI() {
  els.enabled.checked = !!state.enabled;
  els.modeButtons.forEach(btn => btn.classList.toggle('active', btn.dataset.mode === state.mode));
  els.intensity.value = Math.round((state.intensity ?? 0.85) * 100);
  els.intensityValue.textContent = `${els.intensity.value}%`;
  els.speechBoost.value = Math.round((state.speechBoost ?? 1.0) * 10);
  els.speechBoostValue.textContent = `${(state.speechBoost ?? 1.0).toFixed(1)}×`;
  els.preserveBass.checked = !!state.preserveBass;
}
async function refreshStatus() {
  if (!activeTab?.id) return;
  try {
    const status = await chrome.tabs.sendMessage(activeTab.id, { type: 'GET_STATUS' });
    const active = (status?.attachedCount > 0) && state.enabled;
    els.status.classList.toggle('active', active);
    els.statusText.textContent = status?.attachedCount > 0 ? (chrome.i18n.getMessage('statusActive', [String(status.attachedCount)]) || `Active on ${status.attachedCount} media`) : (chrome.i18n.getMessage('statusInactive') || 'No media');
  } catch { els.statusText.textContent = chrome.i18n.getMessage('statusUnsupported') || 'Not supported'; }
}
async function persist(p) {
  Object.assign(state, p);
  if (els.siteOverride.checked && activeHost) {
    const overrides = { ...(await chrome.storage.sync.get(['perSiteOverrides'])).perSiteOverrides };
    overrides[activeHost] = { enabled: state.enabled, mode: state.mode, intensity: state.intensity, speechBoost: state.speechBoost, preserveBass: state.preserveBass };
    await chrome.storage.sync.set({ perSiteOverrides: overrides });
  } else {
    await chrome.storage.sync.set({ enabled: state.enabled, mode: state.mode, intensity: state.intensity, speechBoost: state.speechBoost, preserveBass: state.preserveBass });
  }
}
function attachHandlers() {
  els.enabled.addEventListener('change', () => persist({ enabled: els.enabled.checked }));
  els.modeButtons.forEach(btn => btn.addEventListener('click', () => { state.mode = btn.dataset.mode; els.modeButtons.forEach(b => b.classList.toggle('active', b === btn)); persist({ mode: state.mode }); }));
  els.intensity.addEventListener('input', () => { const v = parseInt(els.intensity.value, 10) / 100; els.intensityValue.textContent = `${els.intensity.value}%`; persist({ intensity: v }); });
  els.speechBoost.addEventListener('input', () => { const v = parseInt(els.speechBoost.value, 10) / 10; els.speechBoostValue.textContent = `${v.toFixed(1)}×`; persist({ speechBoost: v }); });
  els.preserveBass.addEventListener('change', () => persist({ preserveBass: els.preserveBass.checked }));
  els.openOptions.addEventListener('click', () => { chrome.runtime.openOptionsPage(); window.close(); });
}
init();
