/* Boki Chess engine worker.
   Loads the vendored Stockfish 19 lite single-threaded build (no SharedArrayBuffer needed).
   Some static hosts serve .wasm as application/octet-stream, which makes
   WebAssembly.instantiateStreaming refuse it. This shim re-labels the .wasm response
   as application/wasm so the engine loads on any host. */
(function () {
  var realFetch = self.fetch.bind(self);
  self.fetch = function (url, opts) {
    return realFetch(url, opts).then(function (r) {
      if (/\.wasm(\?|#|$)/.test(String(url && url.url || url)) && r.ok &&
          (r.headers.get('content-type') || '').indexOf('application/wasm') !== 0) {
        var h = new Headers(r.headers); h.set('content-type', 'application/wasm');
        return new Response(r.body, { status: r.status, statusText: r.statusText, headers: h });
      }
      return r;
    });
  };
})();
importScripts('stockfish-19-lite-single.js');
