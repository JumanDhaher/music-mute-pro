const FRAME_SIZE = 128;
const AI_BUFFER_SECONDS = 1.0;
const AI_LOOKAHEAD_SECONDS = 0.5;

class MusicMuteProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'mode', defaultValue: 1, minValue: 0, maxValue: 3, automationRate: 'k-rate' },
      { name: 'intensity', defaultValue: 0.85, minValue: 0, maxValue: 1, automationRate: 'k-rate' },
      { name: 'speechBoost', defaultValue: 1.0, minValue: 0, maxValue: 4, automationRate: 'k-rate' }
    ];
  }
  constructor() {
    super();
    this.sampleRate = sampleRate;
    this.aiBufferLen = Math.floor(this.sampleRate * AI_BUFFER_SECONDS);
    this.aiLookaheadLen = Math.floor(this.sampleRate * AI_LOOKAHEAD_SECONDS);
    this.delayBufL = new Float32Array(this.aiLookaheadLen);
    this.delayBufR = new Float32Array(this.aiLookaheadLen);
    this.delayWriteIdx = 0;
    this.aiVocals = null;
    this.aiVocalsCursor = 0;
    this.aiPending = false;
    this.aiAnalyseBuf = new Float32Array(this.aiBufferLen * 2);
    this.aiFillIdx = 0;
    this.port.onmessage = (e) => {
      const m = e.data;
      if (m?.type === 'ai-vocals') {
        this.aiVocals = { L: m.L, R: m.R };
        this.aiVocalsCursor = 0;
        this.aiPending = false;
      }
    };
  }
  process(inputs, outputs, parameters) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0 || !input[0]) {
      for (const ch of output) ch.fill(0);
      return true;
    }
    const mode = parameters.mode[0] | 0;
    const intensity = parameters.intensity[0];
    const inL = input[0];
    const inR = input[1] || input[0];
    const outL = output[0];
    const outR = output[1] || output[0];
    if (mode === 0) {
      outL.set(inL);
      if (output[1]) outR.set(inR);
      return true;
    }
    if (mode === 1 || mode === 2) {
      for (let i = 0; i < inL.length; i++) {
        const L = inL[i];
        const R = inR[i];
        let l = L - intensity * R;
        let r = R - intensity * L;
        if (mode === 2) { l = softClip(l); r = softClip(r); }
        outL[i] = l;
        if (output[1]) outR[i] = r;
      }
      return true;
    }
    if (mode === 3) {
      for (let i = 0; i < inL.length; i++) {
        const dlyL = this.delayBufL[this.delayWriteIdx];
        const dlyR = this.delayBufR[this.delayWriteIdx];
        this.delayBufL[this.delayWriteIdx] = inL[i];
        this.delayBufR[this.delayWriteIdx] = inR[i];
        this.delayWriteIdx = (this.delayWriteIdx + 1) % this.aiLookaheadLen;
        let outSampleL = dlyL - intensity * dlyR;
        let outSampleR = dlyR - intensity * dlyL;
        if (this.aiVocals && this.aiVocalsCursor < this.aiVocals.L.length) {
          outSampleL = this.aiVocals.L[this.aiVocalsCursor];
          outSampleR = this.aiVocals.R[this.aiVocalsCursor];
          this.aiVocalsCursor++;
          if (this.aiVocalsCursor >= this.aiVocals.L.length) this.aiVocals = null;
        }
        outL[i] = outSampleL;
        if (output[1]) outR[i] = outSampleR;
      }
      return true;
    }
    outL.set(inL);
    if (output[1]) outR.set(inR);
    return true;
  }
}

function softClip(x) {
  const x2 = x * x;
  return x * (27 + x2) / (27 + 9 * x2);
}

registerProcessor('music-mute-processor', MusicMuteProcessor);
