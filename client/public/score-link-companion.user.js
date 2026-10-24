// ==UserScript==
// @name         NoteRain Score Link Companion v2
// @namespace    https://github.com/noterain/score-link-companion-v2
// @version      0.5.6
// @description  Transfers authorized score resources between MuseScore and NoteRain through Tampermonkey storage.
// @match        https://noterain.app/*
// @match        https://*.noterain.app/*
// @match        https://piano.dalaomai.cn/*
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
var __assign = (this && this.__assign) || function () {
    __assign = Object.assign || function(t) {
        for (var s, i = 1, n = arguments.length; i < n; i++) {
            s = arguments[i];
            for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p))
                t[p] = s[p];
        }
        return t;
    };
    return __assign.apply(this, arguments);
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g = Object.create((typeof Iterator === "function" ? Iterator : Object).prototype);
    return g.next = verb(0), g["throw"] = verb(1), g["return"] = verb(2), typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (g && (g = 0, op[0] && (_ = 0)), _) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __spreadArray = (this && this.__spreadArray) || function (to, from, pack) {
    if (pack || arguments.length === 2) for (var i = 0, l = from.length, ar; i < l; i++) {
        if (ar || !(i in from)) {
            if (!ar) ar = Array.prototype.slice.call(from, 0, i);
            ar[i] = from[i];
        }
    }
    return to.concat(ar || Array.prototype.slice.call(from));
};
(function () {
    'use strict';
    var COMPANION_VERSION = '0.5.6';
    var REQUEST_KEY = 'noterain-active-import';
    var log = function (stage, details) {
        if (details === void 0) { details = {}; }
        console.info('[NoteRain Companion]', stage, details);
    };
    var pageWindow = typeof unsafeWindow === 'object' ? unsafeWindow : window;
    log('boot', {
        version: COMPANION_VERSION,
        href: location.href,
        hostname: location.hostname,
        isMuseScore: /(?:^|\.)musescore\.com$/i.test(location.hostname),
        hasUnsafeWindow: typeof unsafeWindow === 'object',
    });
    if (!/(?:^|\.)musescore\.com$/i.test(location.hostname)) {
        var listeners_1 = new Map();
        var markInstalled_1 = function () {
            var pageDocument = pageWindow.document;
            if (!(pageDocument === null || pageDocument === void 0 ? void 0 : pageDocument.documentElement)) {
                log('marker-waiting-for-document');
                setTimeout(markInstalled_1, 0);
                return;
            }
            pageDocument.documentElement.setAttribute('data-noterain-companion-version', COMPANION_VERSION);
            var marker = pageDocument.querySelector('meta[name="noterain-companion-version"]');
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
        markInstalled_1();
        pageWindow.addEventListener('message', function (event) {
            var request = event.data;
            if ((request === null || request === void 0 ? void 0 : request.type) === 'noterain-companion-version-request'
                && typeof request.nonce === 'string') {
                log('version-request-received', { nonce: request.nonce });
                pageWindow.postMessage({
                    type: 'noterain-companion-version-response',
                    nonce: request.nonce,
                    version: COMPANION_VERSION,
                }, location.origin);
                log('version-response-sent', { nonce: request.nonce, version: COMPANION_VERSION });
                return;
            }
            if ((request === null || request === void 0 ? void 0 : request.type) !== 'noterain-score-bridge-request'
                || typeof request.nonce !== 'string'
                || typeof request.url !== 'string')
                return;
            log('bridge-request-received', { nonce: request.nonce, url: request.url });
            var sourceUrl;
            try {
                sourceUrl = new URL(request.url);
                if (sourceUrl.protocol !== 'https:' || !/(?:^|\.)musescore\.com$/i.test(sourceUrl.hostname))
                    throw new Error();
            }
            catch (_a) {
                return;
            }
            var responseKey = "noterain-import-response:".concat(request.nonce);
            var previous = listeners_1.get(request.nonce);
            if (previous !== undefined)
                GM_removeValueChangeListener(previous);
            var listener = GM_addValueChangeListener(responseKey, function (_key, _oldValue, response) {
                if (!response || response.nonce !== request.nonce)
                    return;
                pageWindow.postMessage(__assign({ type: 'noterain-score-bridge-response' }, response), location.origin);
                if (response.status === 'complete' || response.status === 'failed') {
                    GM_removeValueChangeListener(listener);
                    GM_deleteValue(responseKey);
                    listeners_1.delete(request.nonce);
                }
            });
            listeners_1.set(request.nonce, listener);
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
    var request = GM_getValue(REQUEST_KEY);
    if (!(request === null || request === void 0 ? void 0 : request.nonce) || !(request === null || request === void 0 ? void 0 : request.url) || Date.now() - request.createdAt > 5 * 60 * 1000)
        return;
    var targetUrl = new URL(request.url);
    if (location.pathname !== targetUrl.pathname) {
        location.replace(targetUrl);
        return;
    }
    GM_deleteValue(REQUEST_KEY);
    var importNonce = request.nonce;
    var responseKey = "noterain-import-response:".concat(importNonce);
    var sessionId = importNonce;
    log('session-start', { sessionId: sessionId, url: "".concat(location.origin).concat(location.pathname) });
    history.replaceState(null, '', location.pathname + location.search);
    var sendResponse = function (status, payload) {
        if (payload === void 0) { payload = {}; }
        return GM_setValue(responseKey, __assign({ nonce: importNonce, status: status, version: COMPANION_VERSION, sequence: "".concat(Date.now(), ":").concat(Math.random()) }, payload));
    };
    sendResponse('started');
    var stageLabels = {
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
    var progressView;
    var ensureProgressView = function () {
        var _a;
        if ((_a = progressView === null || progressView === void 0 ? void 0 : progressView.host) === null || _a === void 0 ? void 0 : _a.isConnected)
            return progressView;
        if (!document.documentElement)
            return null;
        var host = document.createElement('div');
        host.id = 'noterain-import-progress';
        host.style.cssText = 'position:fixed;right:16px;bottom:16px;z-index:2147483647;';
        var shadow = host.attachShadow({ mode: 'closed' });
        shadow.innerHTML = "\n      <style>\n        :host { all: initial; }\n        .panel { width:min(320px,calc(100vw - 32px));box-sizing:border-box;padding:12px;border:1px solid #3b4656;border-radius:8px;background:#151a21;color:#f5f7fa;box-shadow:0 12px 36px rgb(0 0 0 / 42%);font-family:ui-sans-serif,system-ui,sans-serif; }\n        .header { display:flex;align-items:center;justify-content:space-between;gap:12px;margin-bottom:8px; }\n        .title { font-size:13px;font-weight:700; }\n        .percent { color:#aab4c3;font-size:12px;font-variant-numeric:tabular-nums; }\n        .status { margin:0 0 9px;color:#d2d8e1;font-size:12px;line-height:1.45; }\n        .track { width:100%;height:5px;overflow:hidden;border-radius:3px;background:#303846; }\n        .bar { width:0;height:100%;border-radius:inherit;background:#55c2a3;transition:width 180ms ease; }\n        .detail { min-height:16px;margin-top:7px;color:#8995a6;font-size:11px; }\n        .panel[data-state=\"failed\"] { border-color:#e3973e; }\n        .panel[data-state=\"failed\"] .bar { background:#e3973e; }\n        .panel[data-state=\"complete\"] .bar { background:#55c2a3; }\n        @media (max-width:560px) { .panel { width:min(280px,calc(100vw - 24px)); } }\n      </style>\n      <section class=\"panel\" role=\"status\" aria-live=\"polite\">\n        <div class=\"header\"><span class=\"title\">NoteRain \u4E50\u8C31\u91C7\u96C6</span><span class=\"percent\">0%</span></div>\n        <p class=\"status\">\u6B63\u5728\u51C6\u5907</p>\n        <div class=\"track\"><div class=\"bar\"></div></div>\n        <div class=\"detail\"></div>\n      </section>";
        (document.body || document.documentElement).appendChild(host);
        progressView = {
            host: host,
            panel: shadow.querySelector('.panel'),
            status: shadow.querySelector('.status'),
            percent: shadow.querySelector('.percent'),
            bar: shadow.querySelector('.bar'),
            detail: shadow.querySelector('.detail'),
        };
        return progressView;
    };
    var progressPercent = function (stage, details) {
        if (stage === 'waiting-for-score')
            return 5;
        if (stage === 'score-ready')
            return 15;
        if (stage === 'signature-ready')
            return 25;
        if (stage === 'midi-url-ready')
            return 35;
        if (stage === 'midi-ready')
            return 45;
        if (stage === 'svg-page-ready') {
            var page = Number(details.page) || 0;
            var pageCount = Math.max(1, Number(details.pageCount) || 1);
            return 45 + Math.round(45 * page / pageCount);
        }
        if (stage === 'uploading-result')
            return 95;
        if (stage === 'complete')
            return 100;
        return 0;
    };
    var updateProgressView = function (stage, details) {
        if (details === void 0) { details = {}; }
        var view = ensureProgressView();
        if (!view) {
            setTimeout(function () { return updateProgressView(stage, details); }, 50);
            return;
        }
        var percent = progressPercent(stage, details);
        view.panel.dataset.state = stage;
        view.status.textContent = stageLabels[stage] || stage;
        view.percent.textContent = "".concat(percent, "%");
        view.bar.style.width = "".concat(percent, "%");
        view.detail.textContent = stage === 'svg-page-ready'
            ? "\u7B2C ".concat(details.page || 0, " / ").concat(details.pageCount || 0, " \u9875")
            : stage === 'midi-ready' && details.bytes
                ? "".concat(Math.max(1, Math.round(details.bytes / 1024)), " KB")
                : stage === 'failed'
                    ? String(details.error || '请返回 NoteRain 查看详情')
                    : '';
    };
    updateProgressView('waiting-for-score');
    var gmRequest = function (label, options) { return new Promise(function (resolve, reject) {
        GM_xmlhttpRequest(__assign(__assign({}, options), { onload: resolve, onerror: function (response) {
                log('gm-request-error', {
                    sessionId: sessionId,
                    label: label,
                    status: (response === null || response === void 0 ? void 0 : response.status) || 0,
                    statusText: (response === null || response === void 0 ? void 0 : response.statusText) || '',
                    finalHost: (function () {
                        try {
                            return new URL((response === null || response === void 0 ? void 0 : response.finalUrl) || options.url).hostname;
                        }
                        catch (_a) {
                            return '';
                        }
                    })(),
                });
                reject(new Error("".concat(label, "_NETWORK_ERROR")));
            }, ontimeout: function () { return reject(new Error("".concat(label, "_NETWORK_TIMEOUT"))); }, timeout: 45000 }));
    }); };
    var waitForScore = function () { return new Promise(function (resolve, reject) {
        var deadline = Date.now() + 60000;
        var check = function () {
            var _a, _b, _c, _d, _e;
            var score = (_d = (_c = (_b = (_a = pageWindow.UGAPP) === null || _a === void 0 ? void 0 : _a.store) === null || _b === void 0 ? void 0 : _b.page) === null || _c === void 0 ? void 0 : _c.data) === null || _d === void 0 ? void 0 : _d.score;
            var firstPage = (_e = document.querySelector('link[rel="preload"][as="image"][href*="score_0.svg"]')) === null || _e === void 0 ? void 0 : _e.href;
            if (score && firstPage)
                resolve({ score: score, firstPage: firstPage });
            else if (Date.now() > deadline)
                reject(new Error('SCORE_PAGE_TIMEOUT'));
            else
                setTimeout(check, 250);
        };
        check();
    }); };
    var arrayBufferToBase64 = function (buffer) {
        var bytes = new Uint8Array(buffer);
        var binary = '';
        for (var offset = 0; offset < bytes.length; offset += 0x8000) {
            binary += String.fromCharCode.apply(String, bytes.subarray(offset, offset + 0x8000));
        }
        return btoa(binary);
    };
    var progress = function (stage_1) {
        var args_1 = [];
        for (var _i = 1; _i < arguments.length; _i++) {
            args_1[_i - 1] = arguments[_i];
        }
        return __awaiter(void 0, __spreadArray([stage_1], args_1, true), void 0, function (stage, details) {
            if (details === void 0) { details = {}; }
            return __generator(this, function (_a) {
                updateProgressView(stage, details);
                log(stage, __assign({ sessionId: sessionId }, details));
                return [2 /*return*/];
            });
        });
    };
    var md5 = function (input) {
        var rotate = function (value, amount) { return (value << amount) | (value >>> (32 - amount)); };
        var add = function (left, right) { return (left + right) | 0; };
        var bytes = new TextEncoder().encode(input);
        var length = Math.ceil((bytes.length + 9) / 64) * 64;
        var data = new Uint8Array(length);
        data.set(bytes);
        data[bytes.length] = 0x80;
        var bits = bytes.length * 8;
        for (var index = 0; index < 8; index++)
            data[length - 8 + index] = Math.floor(bits / Math.pow(2, (index * 8))) & 0xff;
        var a0 = 0x67452301 | 0;
        var b0 = 0xefcdab89 | 0;
        var c0 = 0x98badcfe | 0;
        var d0 = 0x10325476 | 0;
        var shifts = [7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 7, 12, 17, 22, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 5, 9, 14, 20, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 4, 11, 16, 23, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21, 6, 10, 15, 21];
        var constants = Array.from({ length: 64 }, function (_, index) { return Math.floor(Math.abs(Math.sin(index + 1)) * Math.pow(2, 32)) | 0; });
        var _loop_1 = function (offset) {
            var words = Array.from({ length: 16 }, function (_, index) {
                var start = offset + index * 4;
                return data[start] | data[start + 1] << 8 | data[start + 2] << 16 | data[start + 3] << 24;
            });
            var a = a0, b = b0, c = c0, d = d0;
            for (var index = 0; index < 64; index++) {
                var value = void 0, word = void 0;
                if (index < 16) {
                    value = b & c | ~b & d;
                    word = index;
                }
                else if (index < 32) {
                    value = d & b | ~d & c;
                    word = (5 * index + 1) % 16;
                }
                else if (index < 48) {
                    value = b ^ c ^ d;
                    word = (3 * index + 5) % 16;
                }
                else {
                    value = c ^ (b | ~d);
                    word = (7 * index) % 16;
                }
                var next = d;
                d = c;
                c = b;
                b = add(b, rotate(add(add(a, value), add(constants[index], words[word])), shifts[index]));
                a = next;
            }
            a0 = add(a0, a);
            b0 = add(b0, b);
            c0 = add(c0, c);
            d0 = add(d0, d);
        };
        for (var offset = 0; offset < length; offset += 64) {
            _loop_1(offset);
        }
        return [a0, b0, c0, d0].map(function (word) { return [0, 8, 16, 24].map(function (shift) { return ((word >>> shift) & 0xff).toString(16).padStart(2, '0'); }).join(''); }).join('');
    };
    var run = function () { return __awaiter(void 0, void 0, void 0, function () {
        var _a, score, firstPage, bundleUrls, suffix, _i, bundleUrls_1, url, text, suffixMatch, authorization, apiResponse, midiUrl, midiBuffer, midiResponse, gmError_1, fallbackResponse, pages, index, pageUrl, imageAuthorization, imageApiResponse, svgText, response, gmError_2, fallbackResponse;
        var _b, _c, _d, _e;
        return __generator(this, function (_f) {
            switch (_f.label) {
                case 0: return [4 /*yield*/, progress('waiting-for-score')];
                case 1:
                    _f.sent();
                    return [4 /*yield*/, waitForScore()];
                case 2:
                    _a = _f.sent(), score = _a.score, firstPage = _a.firstPage;
                    return [4 /*yield*/, progress('score-ready', { scoreId: score.id, pageCount: score.pages_count })];
                case 3:
                    _f.sent();
                    if (!score.is_downloadable || !score.is_free || score.is_official)
                        throw new Error('SOURCE_NOT_ACCESSIBLE');
                    if (!Number.isInteger(score.pages_count) || score.pages_count < 1 || score.pages_count > 100)
                        throw new Error('INVALID_PAGE_COUNT');
                    bundleUrls = __spreadArray([], document.querySelectorAll('script[src], link[href]'), true).map(function (element) { return element.src || element.href; })
                        .filter(function (src) { return /\/static\/public\/build\/musescore.*\.js(?:\?|$)/.test(src); });
                    suffix = null;
                    _i = 0, bundleUrls_1 = bundleUrls;
                    _f.label = 4;
                case 4:
                    if (!(_i < bundleUrls_1.length)) return [3 /*break*/, 8];
                    url = bundleUrls_1[_i];
                    return [4 /*yield*/, fetch(url)];
                case 5: return [4 /*yield*/, (_f.sent()).text()];
                case 6:
                    text = _f.sent();
                    suffixMatch = text.match(/"([^"]+)"\)\.substr\(0,4\)/);
                    if (suffixMatch) {
                        suffix = suffixMatch[1];
                        return [3 /*break*/, 8];
                    }
                    _f.label = 7;
                case 7:
                    _i++;
                    return [3 /*break*/, 4];
                case 8:
                    if (!suffix)
                        throw new Error('MIDI_AUTH_UNAVAILABLE');
                    return [4 /*yield*/, progress('signature-ready', { bundleCount: bundleUrls.length })];
                case 9:
                    _f.sent();
                    authorization = md5("".concat(score.id, "midi0").concat(suffix)).slice(0, 4);
                    return [4 /*yield*/, fetch("/api/jmuse?id=".concat(score.id, "&type=midi&index=0"), { headers: { Authorization: authorization } })];
                case 10:
                    apiResponse = _f.sent();
                    if (!apiResponse.ok)
                        throw new Error("MIDI_API_HTTP_".concat(apiResponse.status));
                    return [4 /*yield*/, apiResponse.json()];
                case 11:
                    midiUrl = (_c = (_b = (_f.sent())) === null || _b === void 0 ? void 0 : _b.info) === null || _c === void 0 ? void 0 : _c.url;
                    if (!midiUrl)
                        throw new Error('MIDI_URL_UNAVAILABLE');
                    return [4 /*yield*/, progress('midi-url-ready', { host: new URL(midiUrl).hostname })];
                case 12:
                    _f.sent();
                    _f.label = 13;
                case 13:
                    _f.trys.push([13, 15, , 18]);
                    return [4 /*yield*/, gmRequest('MIDI_DOWNLOAD', { method: 'GET', url: midiUrl, responseType: 'arraybuffer' })];
                case 14:
                    midiResponse = _f.sent();
                    if (midiResponse.status < 200 || midiResponse.status >= 300)
                        throw new Error("MIDI_HTTP_".concat(midiResponse.status));
                    midiBuffer = midiResponse.response;
                    return [3 /*break*/, 18];
                case 15:
                    gmError_1 = _f.sent();
                    log('midi-native-fetch-fallback', { sessionId: sessionId, reason: (gmError_1 === null || gmError_1 === void 0 ? void 0 : gmError_1.message) || String(gmError_1) });
                    return [4 /*yield*/, fetch(midiUrl)];
                case 16:
                    fallbackResponse = _f.sent();
                    if (!fallbackResponse.ok)
                        throw new Error("MIDI_FALLBACK_HTTP_".concat(fallbackResponse.status));
                    return [4 /*yield*/, fallbackResponse.arrayBuffer()];
                case 17:
                    midiBuffer = _f.sent();
                    return [3 /*break*/, 18];
                case 18: return [4 /*yield*/, progress('midi-ready', { bytes: (midiBuffer === null || midiBuffer === void 0 ? void 0 : midiBuffer.byteLength) || 0 })];
                case 19:
                    _f.sent();
                    pages = [];
                    index = 0;
                    _f.label = 20;
                case 20:
                    if (!(index < score.pages_count)) return [3 /*break*/, 32];
                    pageUrl = firstPage;
                    if (!(index > 0)) return [3 /*break*/, 23];
                    imageAuthorization = md5("".concat(score.id, "img").concat(index).concat(suffix)).slice(0, 4);
                    return [4 /*yield*/, fetch("/api/jmuse?id=".concat(score.id, "&type=img&index=").concat(index), {
                            headers: { Authorization: imageAuthorization },
                        })];
                case 21:
                    imageApiResponse = _f.sent();
                    if (!imageApiResponse.ok)
                        throw new Error("SVG_API_HTTP_".concat(imageApiResponse.status, "_PAGE_").concat(index + 1));
                    return [4 /*yield*/, imageApiResponse.json()];
                case 22:
                    pageUrl = (_e = (_d = (_f.sent())) === null || _d === void 0 ? void 0 : _d.info) === null || _e === void 0 ? void 0 : _e.url;
                    if (!pageUrl)
                        throw new Error("SVG_URL_UNAVAILABLE_PAGE_".concat(index + 1));
                    _f.label = 23;
                case 23:
                    svgText = void 0;
                    _f.label = 24;
                case 24:
                    _f.trys.push([24, 26, , 29]);
                    return [4 /*yield*/, gmRequest('SVG_DOWNLOAD', { method: 'GET', url: pageUrl.toString(), responseType: 'text' })];
                case 25:
                    response = _f.sent();
                    if (response.status < 200 || response.status >= 300)
                        throw new Error("SVG_HTTP_".concat(response.status, "_PAGE_").concat(index + 1));
                    svgText = response.responseText;
                    return [3 /*break*/, 29];
                case 26:
                    gmError_2 = _f.sent();
                    log('svg-native-fetch-fallback', {
                        sessionId: sessionId,
                        page: index + 1,
                        reason: (gmError_2 === null || gmError_2 === void 0 ? void 0 : gmError_2.message) || String(gmError_2),
                    });
                    return [4 /*yield*/, fetch(pageUrl)];
                case 27:
                    fallbackResponse = _f.sent();
                    if (!fallbackResponse.ok)
                        throw new Error("SVG_FALLBACK_HTTP_".concat(fallbackResponse.status, "_PAGE_").concat(index + 1));
                    return [4 /*yield*/, fallbackResponse.text()];
                case 28:
                    svgText = _f.sent();
                    return [3 /*break*/, 29];
                case 29:
                    if (!/^\s*<svg\b/i.test(svgText))
                        throw new Error("INVALID_SVG_RESPONSE_PAGE_".concat(index + 1));
                    pages.push(svgText);
                    return [4 /*yield*/, progress('svg-page-ready', { page: index + 1, pageCount: score.pages_count })];
                case 30:
                    _f.sent();
                    _f.label = 31;
                case 31:
                    index++;
                    return [3 /*break*/, 20];
                case 32: return [4 /*yield*/, progress('uploading-result', { pageCount: pages.length })];
                case 33:
                    _f.sent();
                    sendResponse('complete', { result: {
                            source: { provider: 'musescore', url: location.href, scoreId: score.id, revisionId: score.revision_id },
                            title: score.file_score_title || score.title,
                            metadata: {
                                subtitle: score.subtitle || score.song_name || '',
                                composer: score.composer_name || score.composer || '',
                                arranger: score.arranger_name || score.arranger || '',
                            },
                            midiBase64: arrayBufferToBase64(midiBuffer),
                            pages: pages,
                        } });
                    updateProgressView('complete', { pageCount: pages.length });
                    log('complete', { sessionId: sessionId, pageCount: pages.length });
                    return [2 /*return*/];
            }
        });
    }); };
    run().catch(function (error) { return __awaiter(void 0, void 0, void 0, function () {
        return __generator(this, function (_a) {
            updateProgressView('failed', { error: (error === null || error === void 0 ? void 0 : error.message) || String(error) });
            log('failed', { sessionId: sessionId, error: (error === null || error === void 0 ? void 0 : error.message) || String(error), stack: error === null || error === void 0 ? void 0 : error.stack });
            try {
                sendResponse('failed', { error: (error === null || error === void 0 ? void 0 : error.message) || 'IMPORT_FAILED' });
            }
            catch (_b) { }
            return [2 /*return*/];
        });
    }); });
})();
