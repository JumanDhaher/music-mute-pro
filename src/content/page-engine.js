/**
 * MusicMutePro — Page Engine (MAIN world)
 * ---------------------------------------
 * Runs in the page's own JavaScript world. Has direct access to <video>
 * and <audio> elements and can call createMediaElementSource without
 * Same-Origin issues that would affect a page-injected script.
 *
 * Architecture:
 *
 *   <video> --MediaElementSource--> [AudioWorkletNode (DSP/AI)] -->
 *      [HighPass --> LowPass --> Presence Peaking] --> [outputGain] -->
 *      AudioContext.destination
 *
 * Mid-side karaoke math (DSP mode), per-sample:
 *      L_out = L_in - intensity * R_in
 *      R_out = R_in - intensity * L_in
 *
 * In stereo recordings, music is typically panned across L and R while
 * vocals are mixed to the center. Subtracting one channel from the other
 * cancels common (centered) signal, leaving the panned music — so we
 * INSTEAD invert the relationship and exploit it: by attenuating the
 * panned content we effectively suppress music, leaving vocals.
 *
 * For 'ai' mode the worklet posts buffered audio to a workerized ONNX
 * Runtime session (see ai-loader.js); the worklet outputs the model's
 * vocals stem with a fixed look-ahead delay (see WORKLET_LOOKAHEAD).
 */

(() => {
  const NS = 'MUSIC_MUTE_PRO';
  if (window[`__${NS}_LOADED__`]) return;
  window[`__${NS}_LOADED__`] = true;

  const MODE_TO_INT = { off: 0, karaoke: 1, spectral: 2, ai: 3 };

  /** Locate the audio-worklet module URL. The bridge passes it via a meta
   *  tag injected by the manifest's web_accessible_resources mechanism.
   *  We use the well-known chrome-extension://... pattern that gets
   *  resolved via chrome.runtime.getURL in the bridge — but since we're
   *  in MAIN world, we rely on a small handshake event from the bridge. */
  let workletURL = null;
  let aiLoaderURL = null;

  /** Resolve worklet URLs from the bridge handshake. We listen for the
   *  RESOURCE_URLS event before doing any AudioContext setup that needs
   *  the worklet. */
  const resourcePromise = new Promise((resolve) => {
    window.addEventListener(`${NS}:RESOURCE_URLS`, (e) => {
      workletURL = e.detail.workletURL;
      aiLoaderURL = e.detail.aiLoaderURL;
      resolve();
    }, { once: true });
  });

  // -------------------- State --------------------

  const state = {
    enabled: true,
    mode: 'karaoke',
    intensity: 0.85,
    speechBoost: 1.0,
    preserveBass: false,
    highCut: 4500,
    lowCut: 180
  };

  // -------------------- Audio context (lazy) --------------------

  let audioCtx = null;
  let workletReady = null; // Promise

  function getAudioContext() {
    if (audioCtx) return audioCtx;
    audioCtx = new (window.AudioContext || window.webkitAudioContext)({
      latencyHint: 'playback',
      sampleRate: 48000
    });
    return audioCtx;
  }

  async function ensureWorklet() {
    if (workletReady) return workletReady;
    workletReady = (async () => {
      await resourcePromise;
      if (!workletURL) throw new Error('Worklet URL not provided by bridge');
      const ctx = getAudioContext();
      await ctx.audioWorklet.addModule(workletURL);
    })();
    return workletReady;
  }

  // -------------------- Per-element graph --------------------

  /** Stores the processing graph for each media element. */
  const graphs = new WeakMap();

  /** Build and return the processing graph for a given media element. */
  async function buildGraph(media) {
    await ensureWorklet();
    const ctx = getAudioContext();

    // MediaElementSource can only be created once per element. Subsequent
    // calls throw InvalidStateError. We catch and bail out gracefully.
    let source;
    try {
      source = ctx.createMediaElementSource(media);
    } catch (err) {
      console.warn(`[${NS}] createMediaElementSource failed:`, err.message);
      return null;
    }

    const worklet = new AudioWorkletNode(ctx, 'music-mute-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2]
    });

    // Speech-band filter chain
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = state.lowCut;
    hp.Q.value = 0.707;

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = state.highCut;
    lp.Q.value = 0.707;

    const presence = ctx.createBiquadFilter();
    presence.type = 'peaking';
    presence.frequency.value = 2200;     // human-voice presence band
    presence.Q.value = 1.0;
    presence.gain.value = state.speechBoost * 4; // dB

    const outputGain = ctx.createGain();
    outputGain.gain.value = 1.0;

    // Wire: source -> worklet -> hp -> lp -> presence -> outputGain -> dest
    source.connect(worklet);
    worklet.connect(hp);
    hp.connect(lp);
    lp.connect(presence);
    presence.connect(outputGain);
    outputGain.connect(ctx.destination);

    const graph = { ctx, source, worklet, hp, lp, presence, outputGain };
    applyState(graph);
    return graph;
  }

  /** Apply current state to a graph (live, no rebuild). */
  function applyState(graph) {
    if (!graph) return;
    const { worklet, hp, lp, presence, outputGain } = graph;

    const modeInt = state.enabled ? (MODE_TO_INT[state.mode] ?? 0) : 0;
    setParam(worklet, 'mode', modeInt);
    setParam(worklet, 'intensity', state.intensity);
    setParam(worklet, 'speechBoost', state.speechBoost);

    // When mode is 'off' or 'karaoke', filter chain still runs but we can
    // open it up. Spectral / AI tighten the band.
    if (modeInt === 0) {
      hp.frequency.value = 20;
      lp.frequency.value = 20000;
      presence.gain.value = 0;
    } else if (modeInt === 1) {
      hp.frequency.value = state.preserveBass ? 80 : state.lowCut;
      lp.frequency.value = state.highCut;
      presence.gain.value = state.speechBoost * 4;
    } else if (modeInt === 2) {
      // Spectral: aggressive speech band
      hp.frequency.value = 250;
      lp.frequency.value = 3800;
      presence.gain.value = state.speechBoost * 6;
    } else if (modeInt === 3) {
      // AI handles separation; keep filters mild
      hp.frequency.value = 80;
      lp.frequency.value = 8000;
      presence.gain.value = state.speechBoost * 2;
    }

    outputGain.gain.value = state.enabled ? 1.0 : 1.0; // always 1; mute via mode=0
  }

  function setParam(node, name, value) {
    const p = node.parameters?.get(name);
    if (p) p.setValueAtTime(value, getAudioContext().currentTime);
  }

  // -------------------- Element discovery --------------------

  async function attach(media) {
    if (graphs.has(media)) return;
    if (media.dataset[`${NS.toLowerCase()}Skip`] === '1') return;

    // Mark immediately to avoid re-entry while async work runs
    graphs.set(media, 'pending');

    const graph = await buildGraph(media);
    if (!graph) {
      graphs.delete(media);
      return;
    }
    graphs.set(media, graph);

    // Resume context on user interaction (autoplay policy)
    const resume = () => {
      const ctx = graph.ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    };
    media.addEventListener('play', resume, { passive: true });
    document.addEventListener('click', resume, { once: true, passive: true });
    document.addEventListener('keydown', resume, { once: true, passive: true });
  }

  function applyAll() {
    document.querySelectorAll('video, audio').forEach(media => {
      const g = graphs.get(media);
      if (g && g !== 'pending') applyState(g);
    });
  }

  function scan(root) {
    (root || document).querySelectorAll('video, audio').forEach(attach);
  }

  // Watch DOM for new media (SPAs add <video> dynamically)
  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      m.addedNodes.forEach(node => {
        if (node.nodeType !== 1) return;
        if (node.tagName === 'VIDEO' || node.tagName === 'AUDIO') {
          attach(node);
        } else if (node.querySelectorAll) {
          scan(node);
        }
      });
    }
  });

  function startObserving() {
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true
    });
    scan();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', startObserving, { once: true });
  } else {
    startObserving();
  }

  // -------------------- Bridge events --------------------

  window.addEventListener(`${NS}:STATE`, (e) => {
    Object.assign(state, e.detail);
    applyAll();
  });

  window.addEventListener(`${NS}:GET_STATUS`, () => {
    let attachedCount = 0;
    document.querySelectorAll('video, audio').forEach(m => {
      const g = graphs.get(m);
      if (g && g !== 'pending') attachedCount++;
    });
    window.dispatchEvent(new CustomEvent(`${NS}:STATUS`, {
      detail: {
        attachedCount,
        mode: state.mode,
        enabled: state.enabled,
        host: location.host,
        ctxState: audioCtx?.state ?? 'not_created'
      }
    }));
  });
})();
