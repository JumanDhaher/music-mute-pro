/**
 * MusicMutePro — Bridge (ISOLATED world)
 * --------------------------------------
 * Runs in the extension's isolated content-script world. It can use the
 * `chrome.*` APIs but cannot directly access page-level objects such as
 * <video> nodes' MediaElementAudioSource. The page-engine handles those.
 *
 * Responsibilities:
 *   1. Read state from chrome.storage and forward it to the page-engine
 *      via window CustomEvents (the only way to bridge isolated <-> main).
 *   2. Listen for state changes and re-publish them.
 *   3. Respond to popup/background `GET_STATUS` requests by querying the
 *      page-engine and returning a runtime response.
 */

const NS = 'MUSIC_MUTE_PRO';
const DEFAULT_STATE = Object.freeze({
  enabled: true,
  mode: 'karaoke',          // 'off' | 'karaoke' | 'spectral' | 'ai'
  intensity: 0.85,          // 0..1 — strength of music suppression
  speechBoost: 1.0,         // 0..3 — vocal presence boost (dB-ish)
  preserveBass: false,      // keep low frequencies (<200Hz) intact
  highCut: 4500,            // Hz — speech band upper limit
  lowCut: 180,              // Hz — speech band lower limit
  perSiteOverrides: {}      // host -> partial state
});

/** Merge per-site overrides into the global state for the current host. */
function resolveStateForHost(state, host) {
  const override = state.perSiteOverrides?.[host];
  if (!override) return state;
  return { ...state, ...override };
}

/** Push the resolved state to the page-engine. */
async function pushState() {
  let raw;
  try {
    raw = await chrome.storage.sync.get(DEFAULT_STATE);
  } catch (err) {
    // Service worker died or storage unavailable — fall back to defaults
    raw = { ...DEFAULT_STATE };
  }
  const resolved = resolveStateForHost(raw, location.host);
  window.dispatchEvent(new CustomEvent(`${NS}:STATE`, { detail: resolved }));
}

/** Ask the page-engine for its current status (attached count, etc.). */
function requestStatus() {
  return new Promise((resolve) => {
    const handler = (e) => {
      window.removeEventListener(`${NS}:STATUS`, handler);
      resolve(e.detail);
    };
    window.addEventListener(`${NS}:STATUS`, handler, { once: true });
    window.dispatchEvent(new CustomEvent(`${NS}:GET_STATUS`));
    // Failsafe: resolve after 200ms if engine doesn't respond
    setTimeout(() => {
      window.removeEventListener(`${NS}:STATUS`, handler);
      resolve({ attachedCount: 0, error: 'engine_not_loaded' });
    }, 200);
  });
}

// === Wire up listeners ===

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type === 'GET_STATUS') {
    requestStatus().then(sendResponse);
    return true; // async response
  }
  if (msg?.type === 'STATE_CHANGED') {
    pushState();
    sendResponse({ ok: true });
    return false;
  }
  if (msg?.type === 'PING') {
    sendResponse({ pong: true, host: location.host });
    return false;
  }
  return false;
});

chrome.storage.onChanged.addListener((_changes, area) => {
  if (area === 'sync') pushState();
});

// === Resource URL handshake ===
// The page-engine runs in MAIN world and cannot call chrome.runtime.*.
// We forward the worklet/AI loader URLs as a one-shot CustomEvent.
function publishResourceURLs() {
  const detail = {
    workletURL: chrome.runtime.getURL('src/audio/audio-worklet.js'),
    aiLoaderURL: chrome.runtime.getURL('src/audio/ai-loader.js'),
    modelsBaseURL: chrome.runtime.getURL('models/')
  };
  window.dispatchEvent(new CustomEvent(`${NS}:RESOURCE_URLS`, { detail }));
}

// Initial sync — wait until the page-engine has registered itself.
// The engine sets a sentinel on window when it's ready; if it is not yet
// loaded, we retry a few times.
function whenEngineReady(retries = 40) {
  if (window[`__${NS}_LOADED__`]) {
    publishResourceURLs();
    pushState();
    return;
  }
  if (retries > 0) setTimeout(() => whenEngineReady(retries - 1), 50);
}
whenEngineReady();
