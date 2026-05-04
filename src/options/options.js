const $ = sel => document.querySelector(sel);
const DEFAULTS = {
  enabled: true, mode: 'karaoke', intensity: 0.85, speechBoost: 1.0,
  preserveBass: false, highCut: 4500, lowCut: 180, aiBackend: 'auto', perSiteOverrides: {}
};
function applyI18n() {
  document.documentElement.lang = chrome.i18n.getUILanguage().split('-')[0];
  document.documentElement.dir = ['ar','he','fa'].includes(document.documentElement.lang) ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const m = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (m && !el.querySelector('code')) el.textContent = m;
  });
}
async function init() {
  applyI18n();
  const state = await chrome.storage.sync.get(DEFAULTS);
  $('#lowCut').value = state.lowCut;
  $('#highCut').value = state.highCut;
  $('#aiBackend').value = state.aiBackend || 'auto';
  $('#lowCut').addEventListener('change', e => chrome.storage.sync.set({ lowCut: clamp(+e.target.value, 20, 500) }));
  $('#highCut').addEventListener('change', e => chrome.storage.sync.set({ highCut: clamp(+e.target.value, 2000, 20000) }));
  $('#aiBackend').addEventListener('change', e => chrome.storage.sync.set({ aiBackend: e.target.value }));
  $('#testModel').addEventListener('click', testLoadModel);
  $('#reset').addEventListener('click', resetAll);
  renderSiteList(state.perSiteOverrides || {});
}
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function renderSiteList(overrides) {
  const list = $('#siteList');
  const hosts = Object.keys(overrides);
  list.innerHTML = '';
  if (hosts.length === 0) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = chrome.i18n.getMessage('noOverrides') || 'No per-site overrides yet.';
    list.appendChild(li);
    return;
  }
  for (const host of hosts) {
    const o = overrides[host];
    const li = document.createElement('li');
    const left = document.createElement('div');
    const main = document.createElement('div');
    main.textContent = host;
    main.style.fontWeight = '500';
    const meta = document.createElement('div');
    meta.className = 'site-meta';
    meta.textContent = `${o.mode} · intensity ${Math.round((o.intensity ?? 0.85) * 100)}%`;
    left.appendChild(main);
    left.appendChild(meta);
    const remove = document.createElement('button');
    remove.className = 'remove-btn';
    remove.textContent = chrome.i18n.getMessage('removeButton') || 'Remove';
    remove.addEventListener('click', async () => {
      const all = await chrome.storage.sync.get(['perSiteOverrides']);
      const next = { ...(all.perSiteOverrides || {}) };
      delete next[host];
      await chrome.storage.sync.set({ perSiteOverrides: next });
      renderSiteList(next);
    });
    li.appendChild(left);
    li.appendChild(remove);
    list.appendChild(li);
  }
}
async function testLoadModel() {
  const status = $('#modelStatus');
  const label = status.querySelector('.label');
  status.classList.remove('ready', 'error');
  label.textContent = chrome.i18n.getMessage('aiModelLoading') || 'Loading…';
  try {
    const modelURL = chrome.runtime.getURL('models/separator.onnx');
    const head = await fetch(modelURL, { method: 'HEAD' });
    if (!head.ok) {
      status.classList.add('error');
      label.textContent = chrome.i18n.getMessage('aiModelMissing') || 'No model at models/separator.onnx';
      return;
    }
    const { initAISession } = await import(chrome.runtime.getURL('src/audio/ai-loader.js'));
    const ok = await initAISession(modelURL);
    if (ok) {
      status.classList.add('ready');
      label.textContent = chrome.i18n.getMessage('aiModelReady') || 'Model loaded successfully';
    } else {
      status.classList.add('error');
      label.textContent = chrome.i18n.getMessage('aiModelError') || 'Failed to initialize model';
    }
  } catch (err) {
    status.classList.add('error');
    label.textContent = err.message;
  }
}
async function resetAll() {
  const ok = confirm(chrome.i18n.getMessage('resetConfirm') || 'Reset all settings to defaults?');
  if (!ok) return;
  await chrome.storage.sync.clear();
  await chrome.storage.sync.set(DEFAULTS);
  location.reload();
}
init();
