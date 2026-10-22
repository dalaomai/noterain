// ==UserScript==
// @name         NoteRain Score Link Companion
// @namespace    https://github.com/noterain
// @version      0.5.3
// @description  Transfers authorized score resources between MuseScore and NoteRain through Tampermonkey storage.
// @match        https://noterain.app/*
// @match        https://*.noterain.app/*
// @match        https://localhost/*
// @match        http://localhost/*
// @match        https://127.0.0.1/*
// @match        http://127.0.0.1/*
// @match        https://musescore.com/*
// @match        https://www.musescore.com/*
// @match        https://s.musescore.com/*
// @connect      *
// @grant        GM_xmlhttpRequest
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_deleteValue
// @grant        GM_addValueChangeListener
// @grant        GM_removeValueChangeListener
// @grant        unsafeWindow
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';
  const COMPANION_VERSION = '0.5.3';
  const REQUEST_KEY = 'noterain-active-import';

  const log = (stage, details = {}) => {
    console.info('[NoteRain Companion]', stage, details);
  };
  const pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
  log('boot', {
    version: COMPANION_VERSION,
    href: location.href,
    hostname: location.hostname,
    isMuseScore: /(?:^|\.)musescore\.com$/i.test(location.hostname),
    hasUnsafeWindow: typeof unsafeWindow === 'object',
  });

  if (!/(?:^|\.)musescore\.com$/i.test(location.hostname)) {
    const listeners = new Map();
    const markInstalled = () => {
      const pageDocument = pageWindow.document;
      if (!pageDocument?.documentElement) {
        log('marker-waiting-for-document');
        setTimeout(markInstalled, 0);
        return;
      }
      pageDocument.documentElement.setAttribute('data-noterain-companion-version', COMPANION_VERSION);
      let marker = pageDocument.querySelector('meta[name="noterain-companion-version"]');
      if (!marker) {
        marker = pageDocument.createElement('meta');
        marker.setAttribute('name', 'noterain-companion-version');
        (pageDocument.head || pageDocument.documentElement).appendChild(marker);
      }
      marker.setAttribute('content', COMPANION_VERSION);
      log('marker-installed', {
        version: COMPANION_VERSION,
        dataset: pageDocument.documentElement.getAttribute('data-noterain-companion-version'),
        meta: marker.getAttribute('content'),
      });
    };
    markInstalled();
    pageWindow.addEventListener('message', (event) => {
      const request = event.data;
      if (
        request?.type === 'noterain-companion-version-request'
        && typeof request.nonce === 'string'
      ) {
        log('version-request-received', { nonce: request.nonce });
        pageWindow.postMessage({
          type: 'noterain-companion-version-response',
          nonce: request.nonce,
          version: COMPANION_VERSION,
        }, location.origin);
        log('version-response-sent', { nonce: request.nonce, version: COMPANION_VERSION });
        return;
      }
      if (
        request?.type !== 'noterain-score-bridge-request'
        || typeof request.nonce !== 'string'
        || typeof request.url !== 'string'
      ) return;
      log('bridge-request-received', { nonce: request.nonce, url: request.url });
      let sourceUrl;
      try {
        sourceUrl = new URL(request.url);
        if (sourceUrl.protocol !== 'https:' || !/(?:^|\.)musescore\.com$/i.test(sourceUrl.hostname)) throw new Error();
      } catch {
        return;
      }
      const responseKey = `noterain-import-response:${request.nonce}`;
      const previous = listeners.get(request.nonce);
      if (previous !== undefined) GM_removeValueChangeListener(previous);
      const listener = GM_addValueChangeListener(responseKey, (_key, _oldValue, response) => {
        if (!response || response.nonce !== request.nonce) return;
        pageWindow.postMessage({ type: 'noterain-score-bridge-response', ...response }, location.origin);
        if (response.status === 'complete' || response.status === 'failed') {
          GM_removeValueChangeListener(listener);
          GM_deleteValue(responseKey);
          listeners.delete(request.nonce);
        }
      });
      listeners.set(request.nonce, listener);
      GM_setValue(REQUEST_KEY, {
        nonce: request.nonce,
        url: sourceUrl.toString(),
        createdAt: Date.now(),
      });
      pageWindow.postMessage({
        type: 'noterain-score-bridge-response',
        nonce: request.nonce,
        status: 'bridge-ready',
        version: COMPANION_VERSION,
      }, location.origin);
    });
    return;
  }

  const request = GM_getValue(REQUEST_KEY);
  if (!request?.nonce || !request?.url || Date.now() - request.createdAt > 5 * 60 * 1000) return;
  const targetUrl = new URL(request.url);
  if (location.pathname !== targetUrl.pathname) {
    location.replace(targetUrl);
    return;
  }
  GM_deleteValue(REQUEST_KEY);
  const importNonce = request.nonce;
  const responseKey = `noterain-import-response:${importNonce}`;
  const sessionId = importNonce;
  log('session-start', { sessionId, url: `${location.origin}${location.pathname}` });
  history.replaceState(null, '', location.pathname + location.search);
  const sendResponse = (status, payload = {}) => GM_setValue(responseKey, {
    nonce: importNonce,
    status,
    version: COMPANION_VERSION,
    sequence: `${Date.now()}:${Math.random()}`,
    ...payload,
  });
  sendResponse('started');

  const stageLabels = {
    'waiting-for-score': '正在等待乐谱加载',
    'score-ready': '乐谱已加载',
    'signature-ready': '下载授权已就绪',
    'midi-url-ready': '正在下载 MIDI',
    'midi-ready': 'MIDI 下载完成',
    'svg-page-ready': '正在下载乐谱页面',
    'uploading-result': '正在发送到 NoteRain',
    complete: '采集完成，可以返回 NoteRain',
    failed: '采集失败',
  };
  let progressView;

  const ensureProgressView = () => {
    if (progressView?.host?.isConnected) return progressView;
    if (!document.documentElement) return null;
    const host = document.createElement('div');
    host.id = 'noterain-import-progress';
    host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
    const shadow = host.attachShadow({ mode: 'closed' });
    shadow.innerHTML = `
      <style>
        :host { all: initial; }
        .panel { width:min(320px,calc(100vw - 32px));box-sizing:border-box;padding:12px;border:1px solid #3b4656;border-radius:8px;background:#151a21;color:#f5f7fa;box-shadow:0 12px 36px rgb(0 0 0 / 42%);font-family:ui-sans-serif,system-ui,sans-serif; }
        .header { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px; }
        .title { font-size:13px;font-weight:700; }
        .percent { color:#aab4c3;font-size:12px;font-variant-numeric:tabular-nums; }
        .status { margin:0 0 9px;color:#d2d8e1;font-size:12px;line-height:1.45; }
        .track { width:100%;height:5px;overflow:hidden;border-radius:3px;background:#303846; }
        .bar { width:0;height:100%;border-radius:inherit;background:#55c2a3;transition:width 180ms ease; }
        .detail { min-height:16px;margin-top:7px;color:#8995a6;font-size:11px; }
        .panel[data-state="failed"] { border-color:#e3973e; }
        .panel[data-state="failed"] .bar { background:#e3973e; }
        .panel[data-state="complete"] .bar { background:#55c2a3; }
        @media (max-width:560px) { .panel { width:min(280px,calc(100vw - 24px)); } }
      </style>
      <section class="panel" role="status" aria-live="polite">
        <div class="header"><span class="title">NoteRain 乐谱采集</span><span class="percent">0%</span></div>
        <p class="status">正在准备</p>
        <div class="track"><div class="bar"></div></div>
        <div class="detail"></div>
      </section>`;
    (document.body || document.documentElement).appendChild(host);
    progressView = {
      host,
      panel: shadow.querySelector('.panel'),
      status: shadow.querySelector('.status'),
      percent: shadow.querySelector('.percent'),
      bar: shadow.querySelector('.bar'),
      detail: shadow.querySelector('.detail'),
    };
    return progressView;
  };

  const progressPercent = (stage, details) => {
    if (stage === 'waiting-for-score') return 5;
    if (stage === 'score-ready') return 15;
    if (stage === 'signature-ready') return 25;
    if (stage === 'midi-url-ready') return 35;
    if (stage === 'midi-ready') return 45;
    if (stage === 'svg-page-ready') {
      const page = Number(details.page) || 0;
      const pageCount = Math.max(1, Number(details.pageCount) || 1);
      return 45 + Math.round(45 * page / pageCount);
    }
    if (stage === 'uploading-result') return 95;
    if (stage === 'complete') return 100;
    return 0;
  };

  const updateProgressView = (stage, details = {}) => {
    const view = ensureProgressView();
    if (!view) {
      setTimeout(() => updateProgressView(stage, details), 50);
      return;
    }
    const percent = progressPercent(stage, details);
    view.panel.dataset.state = stage;
    view.status.textContent = stageLabels[stage] || stage;
    view.percent.textContent = `${percent}%`;
    view.bar.style.width = `${percent}%`;
    view.detail.textContent = stage === 'svg-page-ready'
      ? `第 ${details.page || 0} / ${details.pageCount || 0} 页`
      : stage === 'midi-ready' && details.bytes
        ? `${Math.max(1, Math.round(details.bytes / 1024))} KB`
        : stage === 'failed'
          ? String(details.error || '请返回 NoteRain 查看详情')
          : '';
  };

  updateProgressView('waiting-for-score');

  const gmRequest = (label, options) => new Promise((resolve, reject) => {
    GM_xmlhttpRequest({
      ...options,
      onload: resolve,
      onerror: (response) => {
        log('gm-request-error', {
          sessionId,
          label,
          status: response?.status || 0,
          statusText: response?.statusText || '',
          finalHost: (() => {
            try { return new URL(response?.finalUrl || options.url).hostname; } catch { return ''; }
          })(),
        });
        reject(new Error(`${label}_NETWORK_ERROR`));
      },
      ontimeout: () => reject(new Error(`${label}_NETWORK_TIMEOUT`)),
      timeout: 45_000,
    });
  });

  const waitForScore = () => new Promise((resolve, reject) => {
    const deadline = Date.now() + 60_000;
    const check = () => {
      const score = pageWindow.UGAPP?.store?.page?.data?.score;
      const firstPage = document.querySelector('link[rel="preload"][as="image"][href*="score_0.svg"]')?.href;
      if (score && firstPage) resolve({ score, firstPage });
      else if (Date.now() > deadline) reject(new Error('SCORE_PAGE_TIMEOUT'));
      else setTimeout(check, 250);
    };
    check();
  });

  const arrayBufferToBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
  };

  const progress = async (stage, details = {}) => {
    updateProgressView(stage, details);
    log(stage, { sessionId, ...details });
  };

  const md5 = (input) => {
    const rotate = (value, amount) => (value << amount) | (value >>> (32 - amount));
    const add = (left, right) => (left + right) | 0;
    const bytes = new TextEncoder().encode(input);
    const length = Math.ceil((bytes.length + 9) / 64) * 64;
    const data = new Uint8Array(length);
    data.set(bytes);
    data[bytes.length] = 0x80;
    const bits = bytes.length * 8;
    for (let index = 0; index < 8; index++) data[length - 8 + index] = Math.floor(bits / 2 ** (index * 8)) & 0xff;
    let a0 = 0x67452301 | 0;
    let b0 = 0xefcdab89 | 0;
    let c0 = 0x98badcfe | 0;
    let d0 = 0x10325476 | 0;
    const shifts = [7,12,17,22,7,12,17,22,7,12,17,22,7,12,17,22,5,9,14,20,5,9,14,20,5,9,14,20,5,9,14,20,4,11,16,23,4,11,16,23,4,11,16,23,4,11,16,23,6,10,15,21,6,10,15,21,6,10,15,21,6,10,15,21];
    const constants = Array.from({ length: 64 }, (_, index) => Math.floor(Math.abs(Math.sin(index + 1)) * 2 ** 32) | 0);
    for (let offset = 0; offset < length; offset += 64) {
      const words = Array.from({ length: 16 }, (_, index) => {
        const start = offset + index * 4;
        return data[start] | data[start + 1] << 8 | data[start + 2] << 16 | data[start + 3] << 24;
      });
      let a = a0, b = b0, c = c0, d = d0;
      for (let index = 0; index < 64; index++) {
        let value, word;
        if (index < 16) { value = b & c | ~b & d; word = index; }
        else if (index < 32) { value = d & b | ~d & c; word = (5 * index + 1) % 16; }
        else if (index < 48) { value = b ^ c ^ d; word = (3 * index + 5) % 16; }
        else { value = c ^ (b | ~d); word = (7 * index) % 16; }
        const next = d;
        d = c;
        c = b;
        b = add(b, rotate(add(add(a, value), add(constants[index], words[word])), shifts[index]));
        a = next;
      }
      a0 = add(a0, a); b0 = add(b0, b); c0 = add(c0, c); d0 = add(d0, d);
    }
    return [a0,b0,c0,d0].map((word) => [0,8,16,24].map((shift) => ((word >>> shift) & 0xff).toString(16).padStart(2, '0')).join('')).join('');
  };

  const run = async () => {
    await progress('waiting-for-score');
    const { score, firstPage } = await waitForScore();
    await progress('score-ready', { scoreId: score.id, pageCount: score.pages_count });
    if (!score.is_downloadable || !score.is_free || score.is_official) throw new Error('SOURCE_NOT_ACCESSIBLE');
    if (!Number.isInteger(score.pages_count) || score.pages_count < 1 || score.pages_count > 100) throw new Error('INVALID_PAGE_COUNT');

    const bundleUrls = [...document.querySelectorAll('script[src], link[href]')]
      .map((element) => element.src || element.href)
      .filter((src) => /\/static\/public\/build\/musescore.*\.js(?:\?|$)/.test(src));
    let suffix = null;
    for (const url of bundleUrls) {
      const text = await (await fetch(url)).text();
      const suffixMatch = text.match(/"([^"]+)"\)\.substr\(0,4\)/);
      if (suffixMatch) { suffix = suffixMatch[1]; break; }
    }
    if (!suffix) throw new Error('MIDI_AUTH_UNAVAILABLE');
    await progress('signature-ready', { bundleCount: bundleUrls.length });
    const authorization = md5(`${score.id}midi0${suffix}`).slice(0, 4);
    const apiResponse = await fetch(`/api/jmuse?id=${score.id}&type=midi&index=0`, { headers: { Authorization: authorization } });
    if (!apiResponse.ok) throw new Error(`MIDI_API_HTTP_${apiResponse.status}`);
    const midiUrl = (await apiResponse.json())?.info?.url;
    if (!midiUrl) throw new Error('MIDI_URL_UNAVAILABLE');
    await progress('midi-url-ready', { host: new URL(midiUrl).hostname });
    let midiBuffer;
    try {
      const midiResponse = await gmRequest('MIDI_DOWNLOAD', { method: 'GET', url: midiUrl, responseType: 'arraybuffer' });
      if (midiResponse.status < 200 || midiResponse.status >= 300) throw new Error(`MIDI_HTTP_${midiResponse.status}`);
      midiBuffer = midiResponse.response;
    } catch (gmError) {
      log('midi-native-fetch-fallback', { sessionId, reason: gmError?.message || String(gmError) });
      const fallbackResponse = await fetch(midiUrl);
      if (!fallbackResponse.ok) throw new Error(`MIDI_FALLBACK_HTTP_${fallbackResponse.status}`);
      midiBuffer = await fallbackResponse.arrayBuffer();
    }
    await progress('midi-ready', { bytes: midiBuffer?.byteLength || 0 });

    const pages = [];
    for (let index = 0; index < score.pages_count; index++) {
      let pageUrl = firstPage;
      if (index > 0) {
        const imageAuthorization = md5(`${score.id}img${index}${suffix}`).slice(0, 4);
        const imageApiResponse = await fetch(`/api/jmuse?id=${score.id}&type=img&index=${index}`, {
          headers: { Authorization: imageAuthorization },
        });
        if (!imageApiResponse.ok) throw new Error(`SVG_API_HTTP_${imageApiResponse.status}_PAGE_${index + 1}`);
        pageUrl = (await imageApiResponse.json())?.info?.url;
        if (!pageUrl) throw new Error(`SVG_URL_UNAVAILABLE_PAGE_${index + 1}`);
      }
      let svgText;
      try {
        const response = await gmRequest('SVG_DOWNLOAD', { method: 'GET', url: pageUrl.toString(), responseType: 'text' });
        if (response.status < 200 || response.status >= 300) throw new Error(`SVG_HTTP_${response.status}_PAGE_${index + 1}`);
        svgText = response.responseText;
      } catch (gmError) {
        log('svg-native-fetch-fallback', {
          sessionId,
          page: index + 1,
          reason: gmError?.message || String(gmError),
        });
        const fallbackResponse = await fetch(pageUrl);
        if (!fallbackResponse.ok) throw new Error(`SVG_FALLBACK_HTTP_${fallbackResponse.status}_PAGE_${index + 1}`);
        svgText = await fallbackResponse.text();
      }
      if (!/^\s*<svg\b/i.test(svgText)) throw new Error(`INVALID_SVG_RESPONSE_PAGE_${index + 1}`);
      pages.push(svgText);
      await progress('svg-page-ready', { page: index + 1, pageCount: score.pages_count });
    }

    await progress('uploading-result', { pageCount: pages.length });
    sendResponse('complete', { result: {
      source: { provider: 'musescore', url: location.href, scoreId: score.id, revisionId: score.revision_id },
      title: score.file_score_title || score.title,
      metadata: {
        subtitle: score.subtitle || score.song_name || '',
        composer: score.composer_name || score.composer || '',
        arranger: score.arranger_name || score.arranger || '',
      },
      midiBase64: arrayBufferToBase64(midiBuffer),
      pages,
    } });
    updateProgressView('complete', { pageCount: pages.length });
    log('complete', { sessionId, pageCount: pages.length });
  };

  run().catch(async (error) => {
    updateProgressView('failed', { error: error?.message || String(error) });
    log('failed', { sessionId, error: error?.message || String(error), stack: error?.stack });
    try { sendResponse('failed', { error: error?.message || 'IMPORT_FAILED' }); } catch {}
  });
})();