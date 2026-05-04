// MusicMutePro AI Loader - ONNX-based source separation
const ORT_CDN = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.18.0/dist/ort.min.js';
let ortPromise = null;
let session = null;
let lastError = null;

async function loadORT() {
  if (window.ort) return window.ort;
  if (!ortPromise) {
    ortPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = ORT_CDN;
      s.onload = () => resolve(window.ort);
      s.onerror = () => reject(new Error('Failed to load onnxruntime-web'));
      document.head.appendChild(s);
    });
  }
  return ortPromise;
}

export async function initAISession(modelURL) {
  try {
    const ort = await loadORT();
    const ep = ('gpu' in navigator) ? 'webgpu' : 'wasm';
    if (ort.env?.wasm) {
      ort.env.wasm.numThreads = Math.min(4, navigator.hardwareConcurrency || 2);
      ort.env.wasm.simd = true;
    }
    session = await ort.InferenceSession.create(modelURL, {
      executionProviders: [ep],
      graphOptimizationLevel: 'all'
    });
    lastError = null;
    return true;
  } catch (err) {
    lastError = err.message;
    session = null;
    return false;
  }
}

export async function separate(interleaved, sampleRate) {
  if (!session) return null;
  const ort = window.ort;
  const N = interleaved.length / 2;
  const planar = new Float32Array(2 * N);
  for (let i = 0; i < N; i++) {
    planar[i] = interleaved[i * 2];
    planar[N + i] = interleaved[i * 2 + 1];
  }
  const tensor = new ort.Tensor('float32', planar, [1, 2, N]);
  const inputName = session.inputNames[0];
  let outputs;
  try {
    outputs = await session.run({ [inputName]: tensor });
  } catch (err) {
    lastError = err.message;
    return null;
  }
  const out = outputs[session.outputNames[0]];
  const data = out.data;
  return { L: data.subarray(0, N), R: data.subarray(N, 2 * N) };
}

export function isReady() { return session !== null; }
export function getLastError() { return lastError; }

export async function tryLoadDefaultModel(modelsBaseURL) {
  const defaultURL = (modelsBaseURL || '') + 'separator.onnx';
  try {
    const r = await fetch(defaultURL, { method: 'HEAD' });
    if (!r.ok) return false;
  } catch {
    return false;
  }
  return initAISession(defaultURL);
}
