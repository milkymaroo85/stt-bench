// STT 성능 측정 — 추론 워커
// 모델 로딩과 전사는 모두 이 워커(브라우저 안)에서 실행된다. 음성 데이터는 기기 밖으로 나가지 않는다.
// 인터넷은 라이브러리(jsDelivr)와 모델 파일(Hugging Face) 내려받기에만 쓰인다.

const LIB_URL = 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.3.0';

let tf = null;          // 라이브러리 모듈
let current = null;     // { key, pipe }

function post(msg) { self.postMessage(msg); }

async function ensureLib() {
  if (tf) return tf;
  tf = await import(LIB_URL);
  // 모델은 Hugging Face Hub에서 내려받아 브라우저 Cache API에 저장된다 (두 번째부터는 캐시 사용).
  tf.env.allowLocalModels = false;
  tf.env.useBrowserCache = true;
  return tf;
}

async function unload() {
  if (current && current.pipe) {
    try { await current.pipe.dispose(); } catch (e) { /* ignore */ }
  }
  current = null;
}

async function load({ id, modelId, device, dtype, threads }) {
  const lib = await ensureLib();
  // WASM 스레드 수: 격리(SharedArrayBuffer)된 경우에만 의미가 있다
  const wasmEnv = lib.env.backends && lib.env.backends.onnx && lib.env.backends.onnx.wasm;
  if (wasmEnv) {
    if (threads && threads !== 'auto') wasmEnv.numThreads = +threads;
    else if (self.crossOriginIsolated) wasmEnv.numThreads = Math.max(1, Math.min(8, (navigator.hardwareConcurrency || 2) - 1));
    else wasmEnv.numThreads = 1;
  }
  const key = JSON.stringify([modelId, device, dtype, wasmEnv ? wasmEnv.numThreads : 0]);
  if (current && current.key === key) {
    post({ type: 'loaded', id, cached: true, loadMs: 0, bytes: 0 });
    return;
  }
  await unload();
  const t0 = performance.now();
  let bytesTotal = 0;
  const seen = new Map();
  const pipe = await lib.pipeline('automatic-speech-recognition', modelId, {
    device,
    dtype,
    progress_callback: (p) => {
      if (p.status === 'progress') {
        if (p.total) seen.set(p.file, p.total);
        post({ type: 'progress', id, file: p.file, loaded: p.loaded, total: p.total, progress: p.progress });
      } else if (p.status === 'done' || p.status === 'initiate' || p.status === 'ready') {
        post({ type: 'status', id, status: p.status, file: p.file || '' });
      }
    },
  });
  for (const v of seen.values()) bytesTotal += v;
  current = { key, pipe };
  post({ type: 'loaded', id, cached: false, loadMs: Math.round(performance.now() - t0), bytes: bytesTotal, threads: wasmEnv ? wasmEnv.numThreads : null, isolated: !!self.crossOriginIsolated });
}

async function transcribe({ id, audio, sampleRate, options }) {
  if (!current || !current.pipe) throw new Error('모델이 로드되지 않았습니다');
  if (sampleRate !== 16000) throw new Error('16kHz 오디오가 필요합니다');
  const opts = Object.assign({
    language: 'korean',
    task: 'transcribe',
    return_timestamps: true,
  }, options || {});
  // 30초를 넘는 오디오는 청크 처리
  const durationSec = audio.length / 16000;
  if (durationSec > 30 && opts.chunk_length_s === undefined) {
    opts.chunk_length_s = 30;
    opts.stride_length_s = 5;
  }
  const t0 = performance.now();
  const out = await current.pipe(audio, opts);
  const inferMs = Math.round(performance.now() - t0);
  post({
    type: 'result', id,
    text: (out && out.text) ? out.text : '',
    chunks: (out && out.chunks) ? out.chunks.map(c => ({ ts: c.timestamp, text: c.text })) : [],
    inferMs, durationSec,
  });
}

self.onmessage = async (e) => {
  const msg = e.data;
  try {
    if (msg.type === 'ping') { await ensureLib(); post({ type: 'pong', id: msg.id }); }
    else if (msg.type === 'load') await load(msg);
    else if (msg.type === 'transcribe') await transcribe(msg);
    else if (msg.type === 'unload') { await unload(); post({ type: 'unloaded', id: msg.id }); }
  } catch (err) {
    post({ type: 'error', id: msg.id, message: String(err && err.message ? err.message : err), stack: err && err.stack ? String(err.stack).slice(0, 800) : '' });
  }
};
