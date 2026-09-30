// 인식 워커 — SenseVoice(sherpa-onnx WASM)를 별도 스레드에서 돌린다. 음성은 이 기기 밖으로 나가지 않는다.
const CDN = 'https://cdn.jsdelivr.net/npm/speech-asr@1.1.6/dist/lib/';
importScripts(CDN + 'sherpa-onnx-asr.js');
async function loadGlueBlobUrl() {
  const src = await (await fetch(CDN + 'sherpa-onnx-wasm-main-asr.js')).text();
  const i = src.indexOf('(function(){if(Module["ENVIRONMENT_IS_PTHREAD"]||Module["$ww"])return;var loadPackage=');
  const k = src.indexOf('})();', i) + 5;
  if (i < 0 || k < 5) throw new Error('런타임 글루 패치 실패(버전 불일치)');
  return URL.createObjectURL(new Blob([src.slice(0, i) + src.slice(k)], { type: 'text/javascript' }));
}
let rec = null;
self.onmessage = async (e) => {
  const m = e.data;
  if (m.type === 'init') {
    self.Module = {
      locateFile: (p) => p.endsWith('.wasm') ? CDN + 'sherpa-onnx-wasm-main-asr.wasm' : p,
      print: (s) => postMessage({ type: 'log', text: '[asr] ' + s }),
      printErr: (s) => postMessage({ type: 'log', text: '[asr!] ' + s }),
      preRun: [function () { for (const f of m.files) Module.FS_createDataFile('/', f.fs, new Uint8Array(f.buf), true, true, true); }],
      onRuntimeInitialized: () => {
        try { rec = new OfflineRecognizer(m.config, Module); postMessage({ type: 'ready', ok: !!rec.handle }); }
        catch (err) { postMessage({ type: 'ready', ok: false, error: String(err) }); }
      },
      onAbort: (w) => postMessage({ type: 'ready', ok: false, error: 'abort ' + w }),
    };
    try { importScripts(await loadGlueBlobUrl()); } catch (err) { postMessage({ type: 'ready', ok: false, error: String(err) }); }
  } else if (m.type === 'decode') {
    if (!rec) { postMessage({ type: 'result', id: m.id, text: '', ms: 0, error: 'not ready' }); return; }
    const t0 = performance.now();
    const st = rec.createStream(); st.acceptWaveform(16000, m.audio); rec.decode(st);
    const text = (rec.getResult(st).text || '').trim(); st.free();
    postMessage({ type: 'result', id: m.id, text, ms: performance.now() - t0, audioSec: m.audio.length / 16000 });
  }
};
