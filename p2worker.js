// 2차 정밀 인식 워커 — 별도 WASM 인스턴스에서 문장 단위 오프라인 인식을 돌려 1차(스트리밍)를 막지 않는다
importScripts('https://cdn.jsdelivr.net/npm/speech-asr@1.1.6/dist/lib/sherpa-onnx-asr.js');
async function loadGlueBlobUrl() {
  // Emscripten 글루를 CDN에서 받아, 빌드에 박힌 .data 패키지 로더만 잘라낸다(모델은 우리가 FS에 직접 넣는다)
  const src = await (await fetch('https://cdn.jsdelivr.net/npm/speech-asr@1.1.6/dist/lib/sherpa-onnx-wasm-main-asr.js')).text();
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
      locateFile: (p) => p.endsWith('.wasm') ? 'https://cdn.jsdelivr.net/npm/speech-asr@1.1.6/dist/lib/sherpa-onnx-wasm-main-asr.wasm' : p,
      print: (s) => postMessage({ type: 'log', text: '[p2 wasm] ' + s }),
      printErr: (s) => postMessage({ type: 'log', text: '[p2 wasm!] ' + s }),
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
