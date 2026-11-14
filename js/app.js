/* 1B AI Film Studio Calculator — application logic (vanilla ES2020, zero dependencies) */
'use strict';

(() => {
  /* =====================================================================
     1. Utilities
     ===================================================================== */
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(Math.max(v, a), b);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const debounce = (fn, ms) => { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };

  function h(tag, attrs, ...kids) {
    const e = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v == null || v === false) continue;
      if (k === 'class') e.className = v;
      else if (k === 'text') e.textContent = v;
      else if (k === 'html') e.innerHTML = v;
      else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2), v);
      else if (k === 'dataset') Object.assign(e.dataset, v);
      else if (k === 'value') e.value = v;
      else e.setAttribute(k, v === true ? '' : v);
    }
    kids.flat().forEach((c) => { if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c)); });
    return e;
  }

  const nf = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 });
  const nf1 = new Intl.NumberFormat('en-US', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  const num = (v) => (Number.isFinite(v) ? nf.format(v) : '—');
  function usd(n, d) {
    if (!Number.isFinite(n)) return '—';
    const abs = Math.abs(n);
    const dd = d ?? (abs >= 1000 ? 0 : abs >= 1 ? 2 : 3);
    return n.toLocaleString('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: dd, maximumFractionDigits: dd });
  }
  function mmss(s) {
    const t = Math.max(0, Math.round(s));
    return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
  }
  function abbr(v) {
    const a = Math.abs(v);
    if (a >= 1e9) return `${nf.format(v / 1e9)}B`;
    if (a >= 1e6) return `${nf.format(v / 1e6)}M`;
    if (a >= 1e3) return `${nf.format(v / 1e3)}K`;
    return nf.format(v);
  }
  const FMT_OUT = {
    currency: (v) => usd(v),
    seconds: (v) => `${num(v)} s (${mmss(v)})`,
    percent: (v) => `${nf1.format(v)}%`,
    number: (v) => num(v),
    tokens: (v) => `${abbr(v)} tokens`,
    mb: (v) => (Math.abs(v) >= 1000 ? `${nf.format(v / 1000)} GB` : `${nf.format(v)} MB`)
  };
  const FMT_LABEL = { currency: 'Currency ($)', seconds: 'Seconds (m:ss)', percent: 'Percentage', number: 'Plain number', tokens: 'Tokens', mb: 'Megabytes' };

  function download(filename, blobOrText, type = 'application/json') {
    const blob = blobOrText instanceof Blob ? blobOrText : new Blob([blobOrText], { type });
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: filename });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  function toast(msg, actionLabel, action) {
    const region = $('#toasts');
    const el = h('div', { class: 'toast' }, h('span', { text: msg }));
    if (actionLabel && action) {
      el.append(h('button', { type: 'button', text: actionLabel, onclick: () => { action(); el.remove(); } }));
    }
    region.append(el);
    setTimeout(() => el.remove(), actionLabel ? 7000 : 3200);
  }

  /* =====================================================================
     2. Persistence — localStorage with IndexedDB fallback/mirror
     ===================================================================== */
  const STORE_KEY = '1b-ai-calc:v1';
  const idb = {
    open() {
      return new Promise((resolve, reject) => {
        if (!('indexedDB' in window)) return reject(new Error('no idb'));
        const req = indexedDB.open('1b-ai-calc', 1);
        req.onupgradeneeded = () => req.result.createObjectStore('kv');
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    },
    async get(key) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const r = db.transaction('kv').objectStore('kv').get(key);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    },
    async set(key, val) {
      const db = await this.open();
      return new Promise((resolve, reject) => {
        const tx = db.transaction('kv', 'readwrite');
        tx.objectStore('kv').put(val, key);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  };
  async function loadStored() {
    let raw = null;
    try { raw = localStorage.getItem(STORE_KEY); } catch (e) { /* storage blocked */ }
    if (!raw) { try { raw = await idb.get(STORE_KEY); } catch (e) { /* no idb */ } }
    if (!raw) return null;
    try { return JSON.parse(raw); } catch (e) { return null; }
  }
  const persist = debounce(() => {
    const raw = JSON.stringify(S);
    try { localStorage.setItem(STORE_KEY, raw); } catch (e) { /* quota or blocked */ }
    idb.set(STORE_KEY, raw).catch(() => {});
  }, 250);

  /* =====================================================================
     3. Domain data
     ===================================================================== */
  const MODELS = {
    s25: { name: 'Seedance 2.5', note: 'Multi-shot cinematic video with native audio; text, image or reference inputs', std: { 480: 0.11, 720: 0.24, 1080: 0.60 }, ref: null },
    s20: { name: 'Seedance 2.0', note: 'Cinematic video with native audio & multi-shot narratives', std: { 480: 0.074, 720: 0.16, 1080: 0.39 }, ref: { 480: 0.045, 720: 0.098, 1080: 0.24 } },
    s20f: { name: 'Seedance 2.0 Fast', note: '2.0 aesthetic at faster turnaround, up to 720p', std: { 480: 0.056, 720: 0.12 }, ref: { 480: 0.033, 720: 0.071 } },
    s20m: { name: 'Seedance 2.0 Mini', note: 'Quick drafts and rapid iteration, up to 720p', std: { 480: 0.035, 720: 0.076 }, ref: { 480: 0.021, 720: 0.045 } }
  };
  const SEEDREAM = {
    draft: { name: 'Seedream Draft', price: 0.02 },
    pro: { name: 'Seedream Pro', price: 0.04 },
    ultra: { name: 'Seedream Ultra 4K', price: 0.08 }
  };
  const THEMES = [
    ['01', 'Society, Community & Humanitarian Issues'],
    ['02', 'Truth, Fake News & Misinformation'],
    ['03', 'Humans & AI'],
    ['04', 'Climate, Nature & Our Changing Planet'],
    ['05', 'Human Relationships']
  ];
  const DEADLINE = new Date('2026-11-20T23:59:59+04:00'); /* Dubai time */
  const ROADMAP = [
    ['Submissions open', 'Prepare, generate and finish your film'],
    ['Submission deadline', '20 November 2026'],
    ['Top 50 & public voting', 'Shortlist announced; the public votes'],
    ['Top 5 announcement', 'Finalists revealed'],
    ['Premiere & $1M Grand Prize', 'Dubai, 8–10 January 2027']
  ];
  const PARTNERS_DIGITAL = [
    ['p-tiktok', 'TikTok', '#FF4D6D'], ['p-meta', 'Meta', '#4C9AFF'], ['p-youtube', 'YouTube', '#FF5A5A'], ['p-instagram', 'Instagram', '#F58CC8'],
    ['p-gemini', 'Gemini', '#8AB4FF'], ['p-tiktoklive', 'TikTok LIVE', '#25F4EE'], ['p-linkedin', 'LinkedIn', '#5AA9FF'], ['p-bilibili', 'Bilibili', '#4DC9F6'],
    ['p-snapchat', 'Snapchat', '#FFE24A'], ['p-byteplus', 'BytePlus Seedance', '#5B9BFF'], ['p-x', 'X', '#F8FAFC']
  ];
  const PARTNERS_DUBAI = [
    ['p-emirates', 'Emirates', '#FF6B6B'], ['p-dcd', 'Dubai Chamber Digital', '#00D2FF'], ['p-difc', 'DIFC', '#E7C873'], ['p-eand', 'e&', '#FF7A7A'],
    ['p-dso', 'Dubai Silicon Oasis', '#00E676'], ['p-motf', 'Museum of the Future', '#C4B5FD'], ['p-rta', 'RTA', '#FFB86B']
  ];

  /** Per-second rate for a model/resolution; reference-clip rate where one is published. */
  function rate(modelKey, res, useRef) {
    const m = MODELS[modelKey];
    if (!m) return NaN;
    const table = useRef && m.ref ? m.ref : m.std;
    const r = table[res];
    return r === undefined ? NaN : r;
  }

  /* Glossary --------------------------------------------------------- */
  const CATS = { rules: 'Competition Rules', seedance: 'Seedance & AI Video', agent: 'AI Agent & Dev', post: 'Post-Production', pwa: 'PWA Tech' };
  const GLOSSARY = [
    ['70% Seedance Threshold', 'rules', 'At least 70% of the final film’s duration must be generated with Seedance as the primary video-generation tool. Up to 30% may come from other AI tools, VFX or post-production. This app measures it as Seedance seconds ÷ total film seconds (title cards and credits count toward the total).'],
    ['Runtime Window (5–7 min)', 'rules', 'The film must run between 5:00 and 7:00 — 300 to 420 seconds in total, including titles and credits.'],
    ['Single Connected Narrative', 'rules', 'Each submission is one complete, connected narrative film — one film, one story — not a reel of unrelated clips.'],
    ['Aspect Ratio 16:9', 'rules', 'The width-to-height ratio of standard widescreen video (1920×1080 at 1080p). The AI Film Award requires horizontal 16:9 cinematic format; vertical 9:16 cuts do not qualify.'],
    ['Minimum 1080p', 'rules', 'The delivered master must be at least 1920×1080 pixels. Drafts at 480p or 720p are fine for iteration, but hero shots in the final cut need to be generated or upscaled to meet this.'],
    ['File Format (.MOV / .MP4)', 'rules', 'Submissions are delivered as a QuickTime .MOV or MPEG-4 .MP4 container. Other containers such as AVI or MKV should be transcoded before submitting.'],
    ['English Subtitles (EN)', 'rules', 'Any spoken language is permitted, but English subtitles are required so judges and the public can follow the story.'],
    ['Official Themes', 'rules', 'Every entry is entered under one of five themes: 01 Society, Community & Humanitarian Issues; 02 Truth, Fake News & Misinformation; 03 Humans & AI; 04 Climate, Nature & Our Changing Planet; 05 Human Relationships.'],
    ['#1MillionStories', 'rules', 'A companion track run with TikTok alongside the AI Film Award, carrying a $100,000 prize.'],
    ['Submission Deadline', 'rules', 'Entries close on 20 November 2026. After that comes the Top 50 and public voting, the Top 5 announcement, and the premiere with the $1,000,000 Grand Prize in Dubai on 8–10 January 2027.'],
    ['Top 50 & Public Voting', 'rules', 'The shortlist stage: fifty films are selected and opened to public voting before the Top 5 finalists are announced.'],

    ['Reference Clip Billing', 'seedance', 'When you supply a reference clip, the job is billed at the cheaper “with reference” per-second rate, multiplied by generated seconds plus the reference clip’s own length. A 10 s output with a 5 s reference bills 15 s at the reference rate.'],
    ['Multi-Shot Narrative', 'seedance', 'Generating several connected shots with consistent characters and style in one pass, so a short sequence reads like edited cinema rather than a single static take.'],
    ['Native Audio Generation', 'seedance', 'The model produces synchronized sound — ambience, effects and speech — along with the picture, so clips arrive with audio instead of silent video.'],
    ['Iteration Multiplier', 'seedance', 'How many takes you generate per shot you keep. A multiplier of 5 means five generations for every shot in the final cut — the single biggest driver of AI-video cost.'],
    ['Draft-to-Final Workflow', 'seedance', 'Explore composition, motion and prompts cheaply with Mini or Fast at 480p–720p, then re-generate only the approved shots with Seedance 2.0 or 2.5 at 1080p.'],
    ['Seedream Keyframing', 'seedance', 'Creating still images — storyboards, character sheets, first frames — with a Seedream image model, then using them as image inputs so Seedance shots start from a locked look.'],
    ['Resolution Tier (480p / 720p / 1080p)', 'seedance', 'Seedance bills per second of output at a rate that rises with resolution. Fast and Mini models top out at 720p.'],
    ['Per-Second Billing', 'seedance', 'Generation cost = rate per second × seconds of video produced. Discarded takes cost the same as kept ones.'],
    ['Dreamina', 'seedance', 'ByteDance’s creative platform that provides access to Seedance video and Seedream image generation in a consumer-friendly interface.'],
    ['Draft Waste', 'seedance', 'Money spent on takes that never reach the final cut — drafting spend plus discarded hero takes. The cost calculator reports it against “Final Cut Spend”.'],

    ['Agentic Orchestration Loop', 'agent', 'A control loop where one or more AI agents plan shots, write prompts, call the generation API, inspect results and decide whether to retry or move on.'],
    ['Webhook Polling', 'agent', 'Checking a generation job’s status on a timer until it finishes. Shorter intervals mean snappier pipelines but more API calls.'],
    ['Retry Budget', 'agent', 'The share of jobs you expect to re-run because of failures or rejected output. A 15% retry rate turns 40 planned shots into 46 billed generations.'],
    ['Token Cost', 'agent', 'Language-model usage priced per million tokens. Multi-agent prompting multiplies calls, so token spend scales with shots × agents × retries.'],
    ['Backoff & Rate Limiting', 'agent', 'When an API throttles you, wait progressively longer between retries instead of hammering the endpoint.'],
    ['Idempotency Key', 'agent', 'A unique ID sent with a request so a retried job is not billed or created twice.'],
    ['Job Queue', 'agent', 'A buffer that feeds generation requests to the API at a controlled pace so concurrency limits are respected.'],

    ['Burned-in vs. SRT EN Subtitles', 'post', 'Burned-in (open) subtitles are rendered into the picture and can’t be turned off. SRT is a separate text file with timings that players overlay. Check the award’s delivery instructions for which you need; this tool accepts either as “ready”.'],
    ['Average Shot Length (ASL)', 'post', 'Runtime divided by number of cuts. Fast action runs 2–4 s; contemplative drama can sit above 8 s.'],
    ['Frame Rate (fps)', 'post', 'Frames per second. 24 fps is the cinematic standard; keep every clip conformed to one rate in the timeline to avoid stutter.'],
    ['Bitrate', 'post', 'Data per second of video. File size in MB ≈ bitrate (Mbps) × seconds ÷ 8.'],
    ['Title Cards & End Credits', 'post', 'Non-footage segments. They count toward total runtime and the 70% denominator, so long credits make the Seedance share harder to reach.'],
    ['Conform', 'post', 'Matching all clips to the project’s resolution, frame rate and colour space before the final export.'],
    ['Codec (H.264 / H.265)', 'post', 'The compression used inside an .MP4 or .MOV. H.264 is the safest for compatibility.'],

    ['Service Worker', 'pwa', 'A background script that intercepts network requests so the app can cache itself and work offline. It is what makes this calculator usable without a connection.'],
    ['Web App Manifest', 'pwa', 'A JSON file describing the app’s name, icons, colours and start URL so the browser can install it like a native app.'],
    ['Maskable Icon', 'pwa', 'An icon with extra safe-zone padding so Android can crop it into a circle, squircle or other shape without clipping the artwork.'],
    ['Open Graph (og:image)', 'pwa', 'Meta tags that control the preview card when a link is shared. og:image must be a PNG or JPG (1200×630 recommended) at an absolute URL.'],
    ['beforeinstallprompt', 'pwa', 'A browser event, fired when a PWA is installable, that lets the app show its own “Install” button. Safari on iOS does not fire it — use Share → Add to Home Screen.'],
    ['Offline Fallback', 'pwa', 'A page the service worker serves when the network is down and the requested page isn’t cached.'],
    ['Safe-Area Insets', 'pwa', 'CSS env() values that keep content clear of notches and home indicators on modern phones.'],
    ['IndexedDB', 'pwa', 'A larger browser database used here as a backup for saved calculators when localStorage is unavailable.']
  ];

  /* =====================================================================
     4. Safe expression engine (no eval)
     ===================================================================== */
  const Expr = (() => {
    const FUNCS = {
      min: Math.min, max: Math.max, ceil: Math.ceil, floor: Math.floor, abs: Math.abs, sqrt: Math.sqrt, pow: Math.pow,
      round: (x, d = 0) => { const p = 10 ** d; return Math.round(x * p) / p; },
      clamp: (x, a, b) => Math.min(Math.max(x, a), b),
      if: (c, a, b) => (c ? a : b)
    };
    function tokenize(src) {
      const out = [];
      let i = 0;
      while (i < src.length) {
        const c = src[i];
        if (/\s/.test(c)) { i++; continue; }
        if (/[0-9.]/.test(c)) {
          const m = /^(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(src.slice(i));
          if (!m) throw new Error('Bad number');
          out.push({ t: 'num', v: parseFloat(m[0]) });
          i += m[0].length;
          continue;
        }
        if (/[A-Za-z_]/.test(c)) {
          const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i));
          out.push({ t: 'id', v: m[0] });
          i += m[0].length;
          continue;
        }
        const two = src.substr(i, 2);
        if (['<=', '>=', '==', '!=', '&&', '||'].includes(two)) { out.push({ t: 'op', v: two }); i += 2; continue; }
        if ('+-*/^%(),<>!?:'.includes(c)) { out.push({ t: 'op', v: c }); i++; continue; }
        throw new Error(`Unexpected “${c}”`);
      }
      return out;
    }

    function evaluate(src, resolve) {
      const tk = tokenize(src);
      if (!tk.length) throw new Error('Empty formula');
      let p = 0;
      const isOp = (v) => tk[p] && tk[p].t === 'op' && tk[p].v === v;
      const expect = (v) => { if (!isOp(v)) throw new Error(`Expected “${v}”`); p++; };
      const startsOperand = (i) => { const t = tk[i]; return !!t && (t.t === 'num' || t.t === 'id' || (t.t === 'op' && t.v === '(')); };

      function ternary() {
        const c = or();
        if (isOp('?')) { p++; const a = ternary(); expect(':'); const b = ternary(); return c ? a : b; }
        return c;
      }
      function or() { let l = and(); while (isOp('||')) { p++; const r = and(); l = l || r ? 1 : 0; } return l; }
      function and() { let l = cmp(); while (isOp('&&')) { p++; const r = cmp(); l = l && r ? 1 : 0; } return l; }
      function cmp() {
        let l = add();
        while (tk[p] && tk[p].t === 'op' && ['<', '>', '<=', '>=', '==', '!='].includes(tk[p].v)) {
          const o = tk[p++].v;
          const r = add();
          const res = { '<': l < r, '>': l > r, '<=': l <= r, '>=': l >= r, '==': l === r, '!=': l !== r }[o];
          l = res ? 1 : 0;
        }
        return l;
      }
      function add() {
        let l = mul();
        while (isOp('+') || isOp('-')) { const o = tk[p++].v; const r = mul(); l = o === '+' ? l + r : l - r; }
        return l;
      }
      function mul() {
        let l = unary();
        while (isOp('*') || isOp('/') || (isOp('%') && startsOperand(p + 1))) {
          const o = tk[p++].v;
          const r = unary();
          l = o === '*' ? l * r : o === '/' ? l / r : l % r;
        }
        return l;
      }
      function unary() {
        if (isOp('-')) { p++; return -unary(); }
        if (isOp('+')) { p++; return unary(); }
        if (isOp('!')) { p++; return unary() ? 0 : 1; }
        return power();
      }
      function power() {
        const b = postfix();
        if (isOp('^')) { p++; const e = unary(); return Math.pow(b, e); }
        return b;
      }
      function postfix() {
        let v = primary();
        while (isOp('%') && !startsOperand(p + 1)) { p++; v /= 100; }
        return v;
      }
      function primary() {
        const t = tk[p];
        if (!t) throw new Error('Formula ended unexpectedly');
        if (t.t === 'num') { p++; return t.v; }
        if (t.t === 'id') {
          p++;
          if (isOp('(')) {
            p++;
            const fn = FUNCS[t.v];
            if (!fn) throw new Error(`Unknown function “${t.v}”`);
            const args = [];
            if (!isOp(')')) { do { args.push(ternary()); if (isOp(',')) p++; else break; } while (true); }
            expect(')');
            return fn(...args);
          }
          return resolve(t.v);
        }
        if (isOp('(')) { p++; const v = ternary(); expect(')'); return v; }
        throw new Error(`Unexpected “${t.v}”`);
      }
      const result = ternary();
      if (p < tk.length) throw new Error(`Unexpected “${tk[p].v ?? tk[p].t}”`);
      if (!Number.isFinite(result)) throw new Error('Result is not a finite number (check for ÷ 0)');
      return result;
    }
    return { evaluate };
  })();

  /* =====================================================================
     5. State
     ===================================================================== */
  const bIn = (name, label, value, min, max, step, unit = '') => ({ type: 'input', name, label, value, min, max, step, unit });
  const bModel = (name, label, model, res, ref = false) => ({ type: 'model', name, label, model, res: String(res), ref });
  const bF = (name, label, expr, fmt = 'number') => ({ type: 'formula', name, label, expr, fmt });
  const bOut = (name, label, expr, fmt, max) => ({ type: 'output', name, label, expr, fmt, max });

  const PRESETS = {
    creator: {
      name: 'Shot-by-Shot Draft-to-1080p Budgeter',
      blocks: [
        bIn('scenes', 'Target scenes', 30, 1, 80, 1, 'scenes'),
        bIn('shotLen', 'Seconds per shot', 12, 3, 20, 1, 's'),
        bIn('draftTakes', 'Draft takes per scene', 4, 1, 12, 1, '×'),
        bIn('heroTakes', 'Hero takes per scene', 2, 1, 6, 1, '×'),
        bModel('draftRate', 'Draft model', 's20m', 480),
        bModel('heroRate', 'Hero model', 's20', 1080),
        bF('draftSec', 'Draft seconds generated', 'scenes * shotLen * draftTakes', 'seconds'),
        bF('heroSec', 'Hero seconds generated', 'scenes * shotLen * heroTakes', 'seconds'),
        bF('draftCost', 'Draft cost', 'draftSec * draftRate', 'currency'),
        bF('heroCost', 'Hero cost', 'heroSec * heroRate', 'currency'),
        bF('total', 'Total generation cost', 'draftCost + heroCost', 'currency'),
        bOut('runtime', 'Final runtime (cap 7:00)', 'scenes * shotLen', 'seconds', 420),
        bOut('spend', 'Total estimated spend', 'total', 'currency', 1000),
        bOut('draftShare', 'Draft share of spend', 'draftCost / total * 100', 'percent', 100),
        bOut('burn', 'Burn per final minute', 'total / (runtime / 60)', 'currency', 500)
      ]
    },
    editor: {
      name: 'Timeline Pacing, Bitrate & Subtitle Sync',
      blocks: [
        bIn('runtime', 'Final runtime (s)', 360, 300, 420, 1, 's'),
        bIn('fps', 'Frame rate', 24, 12, 60, 1, 'fps'),
        bIn('bitrate', 'Delivery bitrate', 20, 2, 80, 1, 'Mbps'),
        bIn('cutsPerMin', 'Cuts per minute', 14, 1, 60, 1, 'cuts'),
        bIn('subLines', 'EN subtitle cues', 90, 0, 400, 1, 'cues'),
        bIn('subDur', 'Average cue duration', 2.4, 0.5, 7, 0.1, 's'),
        bIn('dayRate', 'Editor day rate', 350, 0, 2000, 25, '$'),
        bIn('days', 'Edit days', 6, 1, 30, 1, 'days'),
        bF('frames', 'Total frames', 'runtime * fps', 'number'),
        bF('sizeMB', 'Approx. file size', 'bitrate * runtime / 8', 'mb'),
        bF('cuts', 'Total cuts', 'runtime / 60 * cutsPerMin', 'number'),
        bF('asl', 'Average shot length', 'runtime / cuts', 'seconds'),
        bF('coverage', 'Subtitle coverage', 'subLines * subDur / runtime * 100', 'percent'),
        bF('okWindow', 'Runtime window OK (1 = yes)', 'if(runtime >= 300 && runtime <= 420, 1, 0)', 'number'),
        bOut('oFrames', 'Frames to conform', 'frames', 'number', 30240),
        bOut('oSize', 'File size', 'sizeMB', 'mb', 1500),
        bOut('oAsl', 'Average shot length', 'asl', 'seconds', 15),
        bOut('oCov', 'Subtitle coverage of runtime', 'coverage', 'percent', 100),
        bOut('oWin', 'Runtime window check', 'okWindow', 'number', 1),
        bOut('oEdit', 'Editing cost', 'days * dayRate', 'currency', 5000)
      ]
    },
    agent: {
      name: 'Multi-Agent Orchestration & Retry Estimator',
      blocks: [
        bIn('shots', 'Shots in film', 40, 1, 150, 1, 'shots'),
        bIn('shotLen', 'Seconds per shot', 10, 3, 20, 1, 's'),
        bIn('agents', 'Agent calls per shot', 4, 1, 12, 1, 'agents'),
        bIn('tokensPerCall', 'Tokens per agent call', 2500, 200, 20000, 100, 'tok'),
        bIn('pricePerM', 'LLM price per 1M tokens', 3, 0, 60, 0.5, '$'),
        bIn('retryPct', 'Retry rate', 15, 0, 100, 1, '%'),
        bIn('genTime', 'Avg generation time', 75, 10, 300, 5, 's'),
        bIn('pollEvery', 'Webhook poll interval', 5, 1, 60, 1, 's'),
        bIn('gpuHr', 'Orchestrator GPU price', 1.2, 0, 10, 0.1, '$/hr'),
        bModel('rate', 'Seedance model', 's20f', 720),
        bF('jobs', 'Total generation jobs', 'shots * (1 + retryPct%)', 'number'),
        bF('calls', 'Agent calls', 'jobs * agents', 'number'),
        bF('tokens', 'Total tokens', 'calls * tokensPerCall', 'tokens'),
        bF('tokenCost', 'Token cost', 'tokens / 1000000 * pricePerM', 'currency'),
        bF('polls', 'Status polls', 'jobs * ceil(genTime / pollEvery)', 'number'),
        bF('gpuCost', 'GPU cost', 'jobs * genTime / 3600 * gpuHr', 'currency'),
        bF('genCost', 'Seedance generation cost', 'jobs * shotLen * rate', 'currency'),
        bF('total', 'Pipeline total', 'genCost + tokenCost + gpuCost', 'currency'),
        bOut('oTotal', 'Pipeline total', 'total', 'currency', 500),
        bOut('oTokens', 'Tokens used', 'tokens', 'tokens', 2000000),
        bOut('oPolls', 'Webhook polls', 'polls', 'number', 5000),
        bOut('oRetry', 'Retry-loop overspend', 'genCost - shots * shotLen * rate', 'currency', 100)
      ]
    },
    business: {
      name: 'Commercial Margin, Crew & $1M Award ROI',
      blocks: [
        bIn('fee', 'Client fee', 80000, 0, 250000, 500, '$'),
        bIn('crew', 'Crew headcount', 5, 1, 30, 1, 'people'),
        bIn('crewRate', 'Crew day rate', 400, 0, 2000, 25, '$'),
        bIn('days', 'Production days', 15, 1, 90, 1, 'days'),
        bIn('finalSec', 'Final film length', 360, 300, 420, 1, 's'),
        bIn('retakes', 'Seedance retake multiplier', 3, 1, 10, 0.5, '×'),
        bIn('software', 'Tools & storage', 600, 0, 20000, 50, '$'),
        bIn('overheadPct', 'Studio overhead', 15, 0, 60, 1, '%'),
        bIn('winPct', 'Estimated Grand Prize chance', 0.1, 0, 5, 0.05, '%'),
        bIn('prize', 'Grand Prize', 1000000, 0, 1000000, 10000, '$'),
        bModel('rate', 'Hero model', 's25', 1080),
        bF('gen', 'Seedance generation', 'finalSec * retakes * rate', 'currency'),
        bF('crewCost', 'Crew allocation', 'crew * crewRate * days', 'currency'),
        bF('cost', 'Total cost incl. overhead', '(gen + crewCost + software) * (1 + overheadPct%)', 'currency'),
        bF('margin', 'Commercial margin', 'fee - cost', 'currency'),
        bF('marginPct', 'Margin %', 'margin / fee * 100', 'percent'),
        bF('expPrize', 'Expected award value', 'prize * winPct%', 'currency'),
        bF('roi', 'ROI incl. expected award', '(fee + expPrize - cost) / cost * 100', 'percent'),
        bOut('oCost', 'Total production cost', 'cost', 'currency', 100000),
        bOut('oMargin', 'Commercial margin', 'margin', 'currency', 80000),
        bOut('oMarginPct', 'Margin percentage', 'marginPct', 'percent', 100),
        bOut('oExp', 'Expected $1M award value', 'expPrize', 'currency', 5000),
        bOut('oRoi', 'ROI incl. expected award', 'roi', 'percent', 300)
      ]
    },
    starter: {
      name: 'New calculator',
      blocks: [
        bIn('A', 'Number of shots', 30, 1, 100, 1, 'shots'),
        bIn('B', 'Seconds per shot', 10, 3, 20, 1, 's'),
        bModel('C', 'Model', 's20', 1080),
        bF('D', 'Total seconds', 'A * B', 'seconds'),
        bOut('E', 'Estimated cost', 'D * C', 'currency', 300)
      ]
    }
  };

  function instantiate(key) {
    const p = PRESETS[key];
    return { id: uid(), name: p.name, blocks: p.blocks.map((b) => ({ id: uid(), ...clone(b) })) };
  }

  const costDefaults = () => ({
    runtime: 360, shot: 10,
    draftModel: 's20m', draftRes: '480', draftTakes: 5,
    heroModel: 's20', heroRes: '1080', heroTakes: 2,
    sdTier: 'pro', keyPerShot: 2, extraImgs: 40,
    refOn: false, refLen: 5, refDraft: true, refHero: true,
    sdPrices: { draft: SEEDREAM.draft.price, pro: SEEDREAM.pro.price, ultra: SEEDREAM.ultra.price }
  });
  const compDefaults = () => ({ seedance: 270, other: 70, titles: 20, aspect: '16:9', res: '1080p', container: 'mp4', subs: 'srt', theme: '' });

  let S = { v: 1, tab: 'studio', studio: { cur: instantiate('creator'), saved: [] }, cost: costDefaults(), comp: compDefaults() };

  function mergeState(stored) {
    if (!stored || typeof stored !== 'object') return;
    if (stored.tab) S.tab = stored.tab;
    if (stored.studio && stored.studio.cur && Array.isArray(stored.studio.cur.blocks)) S.studio.cur = stored.studio.cur;
    if (stored.studio && Array.isArray(stored.studio.saved)) S.studio.saved = stored.studio.saved;
    if (stored.cost) S.cost = { ...costDefaults(), ...stored.cost, sdPrices: { ...costDefaults().sdPrices, ...(stored.cost.sdPrices || {}) } };
    if (stored.comp) S.comp = { ...compDefaults(), ...stored.comp };
  }

  /* Data-bound panel controls --------------------------------------- */
  const FMT = {
    secs: (v) => `${num(v)} s · ${mmss(v)}`,
    int: (v) => String(Math.round(v)),
    x: (v) => `${num(v)}×`,
    plain: (v) => String(v)
  };
  const getPath = (o, p) => p.split('.').reduce((a, k) => (a ? a[k] : undefined), o);
  const setPath = (o, p, v) => { const ks = p.split('.'); const last = ks.pop(); ks.reduce((a, k) => a[k], o)[last] = v; };

  function bindPanel(root, onChange) {
    function refresh(except) {
      $$('[data-bind]', root).forEach((el) => {
        if (el === except) return;
        const v = getPath(S, el.dataset.bind);
        if (el.type === 'checkbox') el.checked = !!v;
        else if (v !== undefined) el.value = v;
      });
      $$('[data-out]', root).forEach((o) => {
        const v = getPath(S, o.dataset.out);
        o.textContent = (FMT[o.dataset.fmt] || FMT.plain)(v);
      });
    }
    function commit(el, final) {
      let v;
      if (el.type === 'checkbox') v = el.checked;
      else if (el.type === 'range' || el.type === 'number') {
        v = parseFloat(el.value);
        if (!Number.isFinite(v)) { if (final) refresh(null); return; }
        const mn = el.min !== '' ? +el.min : -Infinity;
        const mx = el.max !== '' ? +el.max : Infinity;
        v = clamp(v, mn, mx);
      } else v = el.value;
      setPath(S, el.dataset.bind, v);
      onChange && onChange(el.dataset.bind);
      refresh(final ? null : el);
      persist();
    }
    root.addEventListener('input', (e) => { const el = e.target.closest('[data-bind]'); if (el && el.type !== 'checkbox' && el.tagName !== 'SELECT') commit(el, false); });
    root.addEventListener('change', (e) => { const el = e.target.closest('[data-bind]'); if (el) commit(el, true); });
    return { refresh: () => refresh(null) };
  }

  /* =====================================================================
     6. Module 1 — Visual Calculator Studio
     ===================================================================== */
  const Studio = (() => {
    let lastExpr = null; /* { input, block } */
    let dragId = null;
    const cur = () => S.studio.cur;
    const blocks = () => S.studio.cur.blocks;

    const TYPE_LABEL = { input: 'Input', model: 'Model', formula: 'Formula', output: 'Output' };
    const VALID_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
    const RESERVED = new Set(Object.keys({ min: 1, max: 1, ceil: 1, floor: 1, abs: 1, sqrt: 1, pow: 1, round: 1, clamp: 1, if: 1 }));

    function compute() {
      const byName = new Map();
      const vals = {};
      const errs = {};
      const dup = new Set();
      blocks().forEach((b) => {
        if (byName.has(b.name)) { dup.add(b.id); return; }
        byName.set(b.name, b);
      });
      const visiting = new Set();
      function get(name) {
        if (Object.prototype.hasOwnProperty.call(vals, name)) return vals[name];
        const b = byName.get(name);
        if (!b) throw new Error(`Unknown variable “${name}”`);
        if (errs[name]) throw new Error(`Depends on “${name}”, which has an error`);
        if (visiting.has(name)) { errs[name] = 'Circular link'; throw new Error(`Circular link through “${name}”`); }
        visiting.add(name);
        try { vals[name] = evalBlock(b); } catch (e) { if (!errs[name]) errs[name] = e.message; throw e; } finally { visiting.delete(name); }
        return vals[name];
      }
      function evalBlock(b) {
        if (b.type === 'input') { const v = Number(b.value); if (!Number.isFinite(v)) throw new Error('Enter a number'); return v; }
        if (b.type === 'model') {
          const r = rate(b.model, b.res, b.ref);
          if (!Number.isFinite(r)) throw new Error(`${MODELS[b.model] ? MODELS[b.model].name : 'Model'} has no ${b.res}p rate`);
          return r;
        }
        return Expr.evaluate(String(b.expr || ''), get);
      }
      blocks().forEach((b) => {
        if (dup.has(b.id)) { errs['#' + b.id] = `Name “${b.name}” is already used`; return; }
        try { get(b.name); } catch (e) { /* recorded in errs */ }
      });
      return { vals, errs, dup };
    }

    function usesOf(b) {
      if (b.type !== 'formula' && b.type !== 'output') return [];
      const names = new Set(blocks().filter((x) => x.id !== b.id).map((x) => x.name));
      const found = [];
      (String(b.expr || '').match(/[A-Za-z_][A-Za-z0-9_]*/g) || []).forEach((id) => { if (names.has(id) && !found.includes(id)) found.push(id); });
      return found;
    }

    function nextName() {
      const used = new Set(blocks().map((b) => b.name));
      for (let i = 0; i < 26; i++) { const n = String.fromCharCode(65 + i); if (!used.has(n)) return n; }
      let k = 1;
      while (used.has('v' + k)) k++;
      return 'v' + k;
    }

    function save() { persist(); }

    function renameVar(oldName, newName) {
      const re = new RegExp(`\\b${oldName}\\b`, 'g');
      blocks().forEach((b) => { if (b.expr) b.expr = b.expr.replace(re, newName); });
    }

    /* --- rendering --- */
    function renderAll() {
      $('#calcName').value = cur().name || '';
      const canvas = $('#canvas');
      canvas.replaceChildren();
      if (!blocks().length) {
        canvas.append(h('div', { class: 'empty', style: 'grid-column:1/-1' },
          h('strong', { text: 'Your canvas is empty' }),
          h('span', { text: 'Add an Input block to start, or load a preset above.' }),
          h('button', { type: 'button', class: 'btn primary', text: 'Load starter calculator', onclick: () => loadPreset('starter') })));
      } else {
        blocks().forEach((b, i) => canvas.append(blockCard(b, i)));
      }
      renderSaved();
      updateLive();
    }

    function modelSelect(b) {
      return h('select', { 'aria-label': 'Model', onchange: (e) => {
        b.model = e.target.value;
        if (!(b.res in MODELS[b.model].std)) b.res = Object.keys(MODELS[b.model].std).pop();
        if (b.ref && !MODELS[b.model].ref) b.ref = false;
        save(); renderAll();
      } }, Object.entries(MODELS).map(([k, m]) => h('option', { value: k, selected: k === b.model, text: m.name })));
    }

    function blockCard(b, i) {
      const card = h('article', { class: 'block', dataset: { id: b.id, type: b.type }, 'aria-label': `${TYPE_LABEL[b.type]} block ${b.label || b.name}` });

      /* drag & drop (handle activates dragging so inputs stay selectable) */
      const handle = h('button', { type: 'button', class: 'btn icon-btn handle', 'aria-label': 'Drag to reorder', title: 'Drag to reorder',
        html: '<svg class="icon" aria-hidden="true"><use href="#i-grip"/></svg>',
        onpointerdown: () => { card.draggable = true; } });
      card.addEventListener('dragstart', (e) => { dragId = b.id; card.classList.add('dragging'); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setData('text/plain', b.id); } catch (x) { /* ignore */ } });
      card.addEventListener('dragend', () => { dragId = null; card.draggable = false; card.classList.remove('dragging'); $$('.block.over').forEach((c) => c.classList.remove('over')); });
      card.addEventListener('dragover', (e) => { if (dragId && dragId !== b.id) { e.preventDefault(); card.classList.add('over'); } });
      card.addEventListener('dragleave', () => card.classList.remove('over'));
      card.addEventListener('drop', (e) => {
        e.preventDefault();
        const from = blocks().findIndex((x) => x.id === dragId);
        const to = blocks().findIndex((x) => x.id === b.id);
        if (from < 0 || to < 0 || from === to) return;
        const [mv] = blocks().splice(from, 1);
        blocks().splice(to, 0, mv);
        save(); renderAll();
      });

      const nameInput = h('input', { class: 'name-field', type: 'text', value: b.name, maxlength: 24, 'aria-label': 'Variable name', autocapitalize: 'off', spellcheck: 'false',
        onchange: (e) => {
          const v = e.target.value.trim();
          if (!VALID_NAME.test(v) || RESERVED.has(v)) { toast('Names start with a letter and use letters, digits or _'); e.target.value = b.name; return; }
          if (v !== b.name) { renameVar(b.name, v); b.name = v; save(); renderAll(); }
        } });

      card.append(h('div', { class: 'block-head' },
        handle,
        h('span', { class: 'badge', text: TYPE_LABEL[b.type] }),
        nameInput,
        h('span', { class: 'spacer' }),
        h('button', { type: 'button', class: 'btn icon-btn', 'aria-label': 'Move up', disabled: i === 0, html: '<svg class="icon" aria-hidden="true"><use href="#i-up"/></svg>', onclick: () => move(i, -1) }),
        h('button', { type: 'button', class: 'btn icon-btn', 'aria-label': 'Move down', disabled: i === blocks().length - 1, html: '<svg class="icon" aria-hidden="true"><use href="#i-down"/></svg>', onclick: () => move(i, 1) }),
        h('button', { type: 'button', class: 'btn icon-btn danger', 'aria-label': 'Delete block', html: '<svg class="icon" aria-hidden="true"><use href="#i-trash"/></svg>', onclick: () => remove(i) })
      ));

      card.append(h('div', { class: 'field' }, h('span', { text: 'Label' }),
        h('input', { type: 'text', value: b.label || '', maxlength: 60, 'aria-label': 'Block label', oninput: (e) => { b.label = e.target.value; save(); updateLive(); } })));

      if (b.type === 'input') {
        const out = h('output', { class: 'mono', 'data-live': 'in' });
        const number = h('input', { type: 'number', inputmode: 'decimal', value: b.value, step: b.step || 'any', 'aria-label': 'Value',
          oninput: (e) => { b.value = parseFloat(e.target.value); range.value = b.value; save(); updateLive(); } });
        const range = h('input', { type: 'range', min: b.min, max: b.max, step: b.step, value: b.value, 'aria-label': `${b.label} slider`,
          oninput: (e) => { b.value = parseFloat(e.target.value); number.value = b.value; save(); updateLive(); } });
        card.append(h('div', { class: 'field' },
          h('div', { class: 'field-line' }, h('span', { text: `Value${b.unit ? ' (' + b.unit + ')' : ''}` }), out),
          h('div', { class: 'num-pair' }, range, number)));
        card.append(h('details', {}, h('summary', { text: 'Slider range & unit' }),
          h('div', { class: 'grid-3', style: 'margin-top:12px' },
            numField('Min', b.min, (v) => { b.min = v; range.min = v; }),
            numField('Max', b.max, (v) => { b.max = v; range.max = v; }),
            numField('Step', b.step, (v) => { b.step = v > 0 ? v : 1; range.step = b.step; number.step = b.step; })),
          h('div', { class: 'field', style: 'margin-top:12px' }, h('span', { text: 'Unit' }),
            h('input', { type: 'text', value: b.unit || '', maxlength: 10, 'aria-label': 'Unit', oninput: (e) => { b.unit = e.target.value; save(); } }))));
      }

      if (b.type === 'model') {
        const m = MODELS[b.model];
        card.append(h('div', { class: 'grid-2' },
          h('div', { class: 'field' }, h('span', { text: 'Model' }), modelSelect(b)),
          h('div', { class: 'field' }, h('span', { text: 'Resolution' }),
            h('select', { 'aria-label': 'Resolution', onchange: (e) => { b.res = e.target.value; save(); updateLive(); } },
              Object.keys(m.std).map((r) => h('option', { value: r, selected: r === String(b.res), text: `${r}p` }))))));
        card.append(h('label', { class: 'check' },
          h('input', { type: 'checkbox', checked: !!b.ref, disabled: !m.ref, onchange: (e) => { b.ref = e.target.checked; save(); updateLive(); } }),
          m.ref ? 'Use reference-clip rate' : 'No published reference-clip rate'));
        card.append(h('p', { class: 'live-sub', text: m.note }));
        card.append(h('div', { class: 'live-val mono', 'data-live': 'val' }));
        card.append(h('div', { class: 'live-sub', text: 'USD per second — available as a variable' }));
      }

      if (b.type === 'formula' || b.type === 'output') {
        const exprInput = h('input', { class: 'expr', type: 'text', value: b.expr || '', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', 'aria-label': 'Expression',
          placeholder: 'e.g. A * B * C', onfocus: () => { lastExpr = { input: exprInput, block: b }; },
          oninput: (e) => { b.expr = e.target.value; save(); updateLive(); } });
        card.append(h('div', { class: 'field' }, h('span', { text: b.type === 'output' ? 'Value to display' : 'Expression' }), exprInput));
        const others = blocks().filter((x) => x.id !== b.id);
        card.append(h('div', { class: 'uses', 'data-live': 'uses' }));
        card.append(h('details', {}, h('summary', { text: `Insert variable (${others.length})` }),
          h('div', { class: 'uses', style: 'margin-top:12px' }, others.map((x) => varChip(x.name, null, () => insertVar(exprInput, b, x.name))))));
        card.append(h('div', { class: 'field' }, h('span', { text: 'Display as' }),
          h('select', { 'aria-label': 'Display format', onchange: (e) => { b.fmt = e.target.value; save(); updateLive(); } },
            Object.entries(FMT_LABEL).map(([k, v]) => h('option', { value: k, selected: k === (b.fmt || 'number'), text: v })))));
        card.append(h('div', { class: 'live-val', 'data-live': 'val' }));
        if (b.type === 'output') {
          card.append(h('div', { class: 'gauge', role: 'progressbar', 'aria-label': `${b.label} gauge`, 'aria-valuemin': 0, 'aria-valuenow': 0, 'aria-valuemax': 100, 'data-live': 'gauge' }, h('i')));
          card.append(h('div', { class: 'gauge-scale' }, h('span', { text: '0' }), h('span', { 'data-live': 'max' })));
          card.append(h('div', { class: 'field' }, h('span', { text: 'Gauge maximum' }),
            h('input', { type: 'number', inputmode: 'decimal', value: b.max, min: 0, step: 'any', 'aria-label': 'Gauge maximum', oninput: (e) => { b.max = parseFloat(e.target.value) || 1; save(); updateLive(); } })));
        }
      }
      return card;
    }

    function numField(label, value, apply) {
      return h('div', { class: 'field' }, h('span', { text: label }),
        h('input', { type: 'number', inputmode: 'decimal', value, step: 'any', 'aria-label': label, oninput: (e) => { const v = parseFloat(e.target.value); if (Number.isFinite(v)) { apply(v); save(); updateLive(); } } }));
    }

    function varChip(name, value, onclick) {
      const btn = h('button', { type: 'button', class: 'var-chip', title: `Insert ${name}`, 'aria-label': `Insert variable ${name}`, onmousedown: (e) => e.preventDefault(), onclick }, name);
      if (value != null) btn.append(h('b', { text: value }));
      return btn;
    }

    function insertVar(input, b, name) {
      const start = input.selectionStart ?? input.value.length;
      const end = input.selectionEnd ?? input.value.length;
      input.value = input.value.slice(0, start) + name + input.value.slice(end);
      b.expr = input.value;
      const pos = start + name.length;
      input.focus();
      input.setSelectionRange(pos, pos);
      save(); updateLive();
    }

    function move(i, d) {
      const j = i + d;
      if (j < 0 || j >= blocks().length) return;
      const [m] = blocks().splice(i, 1);
      blocks().splice(j, 0, m);
      save(); renderAll();
    }

    function remove(i) {
      const [gone] = blocks().splice(i, 1);
      save(); renderAll();
      toast(`Removed “${gone.label || gone.name}”`, 'Undo', () => { blocks().splice(Math.min(i, blocks().length), 0, gone); save(); renderAll(); });
    }

    function add(type) {
      const name = nextName();
      const base = { id: uid(), type, name };
      const defaults = {
        input: { label: 'New input', value: 10, min: 0, max: 100, step: 1, unit: '' },
        model: { label: 'Model', model: 's20', res: '1080', ref: false },
        formula: { label: 'New formula', expr: '', fmt: 'number' },
        output: { label: 'New output', expr: '', fmt: 'number', max: 100 }
      }[type];
      blocks().push({ ...base, ...defaults });
      save(); renderAll();
      const cards = $$('#canvas .block');
      const last = cards[cards.length - 1];
      if (last) { last.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' }); const f = $('input[aria-label="Label"], input[aria-label="Block label"]', last); if (f) f.focus({ preventScroll: true }); }
    }

    /* --- live update --- */
    function updateLive() {
      const { vals, errs, dup } = compute();
      const summary = $('#summary');
      summary.replaceChildren();
      blocks().forEach((b) => {
        const card = $(`.block[data-id="${b.id}"]`);
        const err = dup.has(b.id) ? errs['#' + b.id] : errs[b.name];
        const v = vals[b.name];
        const fmt = b.type === 'model' ? (x) => `${usd(x, 3)}/s` : b.type === 'input' ? (x) => `${num(x)}${b.unit ? ' ' + b.unit : ''}` : (FMT_OUT[b.fmt || 'number'] || FMT_OUT.number);
        const text = err ? null : fmt(v);
        if (b.type === 'output') {
          summary.append(h('div', { class: 'stat' }, h('div', { class: 'k', text: b.label || b.name }), h('div', { class: err ? 'v err' : 'v', text: err ? err : text })));
        }
        if (!card) return;
        const valEl = $('[data-live="val"]', card);
        if (valEl) { valEl.textContent = err ? err : text; valEl.classList.toggle('err', !!err); }
        const inEl = $('[data-live="in"]', card);
        if (inEl) inEl.textContent = err ? err : text;
        const usesEl = $('[data-live="uses"]', card);
        if (usesEl) {
          usesEl.replaceChildren();
          const used = usesOf(b);
          if (used.length) {
            usesEl.append(h('span', { class: 'lbl', text: 'Linked to' }));
            used.forEach((n) => usesEl.append(varChip(n, vals[n] != null && Number.isFinite(vals[n]) ? num(vals[n]) : '—', () => insertVar($('.expr', card), b, n))));
          } else usesEl.append(h('span', { class: 'lbl', text: 'No linked variables yet — type a name or use “Insert variable”.' }));
        }
        const g = $('[data-live="gauge"]', card);
        if (g) {
          const max = Number(b.max) > 0 ? Number(b.max) : 1;
          const pct = err ? 0 : clamp((v / max) * 100, 0, 100);
          $('i', g).style.width = `${pct}%`;
          g.setAttribute('aria-valuenow', Math.round(pct));
          const mx = $('[data-live="max"]', card);
          if (mx) mx.textContent = (FMT_OUT[b.fmt || 'number'] || FMT_OUT.number)(max);
        }
      });
    }

    /* --- presets, save/load/import/export --- */
    function loadPreset(key) {
      S.studio.cur = instantiate(key);
      save(); renderAll();
      toast(`Loaded “${S.studio.cur.name}”`);
    }

    function saveCalc() {
      const c = cur();
      c.name = ($('#calcName').value || '').trim() || 'Untitled calculator';
      const snap = { id: c.id, name: c.name, updated: Date.now(), blocks: clone(c.blocks) };
      const i = S.studio.saved.findIndex((x) => x.id === c.id);
      if (i >= 0) S.studio.saved[i] = snap; else S.studio.saved.unshift(snap);
      save(); renderSaved();
      toast('Saved on this device');
    }

    function renderSaved() {
      const list = $('#savedList');
      list.replaceChildren();
      if (!S.studio.saved.length) {
        list.append(h('div', { class: 'empty' }, h('strong', { text: 'Nothing saved yet' }), h('span', { text: 'Tap Save to keep a calculator offline on this device.' })));
        return;
      }
      S.studio.saved.forEach((s) => {
        list.append(h('div', { class: 'saved-item' },
          h('div', { class: 'meta' }, h('strong', { text: s.name }), h('div', { class: 'live-sub', text: `${s.blocks.length} blocks · ${new Date(s.updated).toLocaleString()}` })),
          h('button', { type: 'button', class: 'btn small', text: 'Open', onclick: () => { S.studio.cur = { id: s.id, name: s.name, blocks: clone(s.blocks) }; save(); renderAll(); window.scrollTo({ top: 0 }); } }),
          h('button', { type: 'button', class: 'btn small', text: 'Export', onclick: () => exportCalc(s) }),
          h('button', { type: 'button', class: 'btn small danger', text: 'Delete', onclick: () => { S.studio.saved = S.studio.saved.filter((x) => x.id !== s.id); save(); renderSaved(); toast(`Deleted “${s.name}”`); } })));
      });
    }

    function exportCalc(c) {
      const data = { app: '1billion-ai-calculator', version: 1, calculator: { name: c.name, blocks: c.blocks.map(({ id, ...rest }) => rest) } };
      const file = (c.name || 'calculator').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'calculator';
      download(`${file}.1b-calc.json`, JSON.stringify(data, null, 2));
    }

    function sanitizeBlock(raw, used) {
      if (!raw || typeof raw !== 'object') return null;
      if (!['input', 'model', 'formula', 'output'].includes(raw.type)) return null;
      const n = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
      let name = typeof raw.name === 'string' && VALID_NAME.test(raw.name) && !RESERVED.has(raw.name) ? raw.name : 'v';
      let k = 1;
      const base = name;
      while (used.has(name)) name = `${base}${k++}`;
      used.add(name);
      const b = { id: uid(), type: raw.type, name, label: String(raw.label || name).slice(0, 60) };
      if (raw.type === 'input') Object.assign(b, { value: n(raw.value, 0), min: n(raw.min, 0), max: n(raw.max, 100), step: n(raw.step, 1) > 0 ? n(raw.step, 1) : 1, unit: String(raw.unit || '').slice(0, 10) });
      if (raw.type === 'model') {
        const mk = MODELS[raw.model] ? raw.model : 's20';
        const res = String(raw.res in MODELS[mk].std ? raw.res : Object.keys(MODELS[mk].std).pop());
        Object.assign(b, { model: mk, res, ref: !!raw.ref && !!MODELS[mk].ref });
      }
      if (raw.type === 'formula' || raw.type === 'output') {
        Object.assign(b, { expr: String(raw.expr || '').slice(0, 300), fmt: FMT_LABEL[raw.fmt] ? raw.fmt : 'number' });
        if (raw.type === 'output') b.max = n(raw.max, 100) > 0 ? n(raw.max, 100) : 100;
      }
      return b;
    }

    function importFile(file) {
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const data = JSON.parse(reader.result);
          const calcs = Array.isArray(data) ? data : [data.calculator || data];
          let imported = 0;
          calcs.forEach((c) => {
            if (!c || !Array.isArray(c.blocks)) return;
            const used = new Set();
            const blks = c.blocks.map((b) => sanitizeBlock(b, used)).filter(Boolean);
            if (!blks.length) return;
            const entry = { id: uid(), name: String(c.name || 'Imported calculator').slice(0, 60), updated: Date.now(), blocks: blks };
            S.studio.saved.unshift(entry);
            S.studio.cur = { id: entry.id, name: entry.name, blocks: clone(entry.blocks) };
            imported++;
          });
          if (!imported) throw new Error('No calculators found');
          save(); renderAll();
          toast(`Imported ${imported} calculator${imported > 1 ? 's' : ''}`);
        } catch (e) { toast('That file isn’t a valid calculator export'); }
      };
      reader.readAsText(file);
    }

    function init() {
      $$('[data-preset]').forEach((btn) => btn.addEventListener('click', () => loadPreset(btn.dataset.preset)));
      $$('[data-add]').forEach((btn) => btn.addEventListener('click', () => add(btn.dataset.add)));
      $('#calcName').addEventListener('input', (e) => { cur().name = e.target.value; save(); });
      $('#saveCalc').addEventListener('click', saveCalc);
      $('#newCalc').addEventListener('click', () => { loadPreset('starter'); });
      $('#exportCalc').addEventListener('click', () => { cur().name = ($('#calcName').value || '').trim() || 'Untitled calculator'; exportCalc(cur()); });
      const imp = $('#importFile');
      imp.addEventListener('change', () => { if (imp.files[0]) importFile(imp.files[0]); imp.value = ''; });
      $('#importLabel').addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); imp.click(); } });
      renderAll();
    }
    return { init, renderAll, loadPreset, compute };
  })();

  /* =====================================================================
     7. Module 2 — Seedance Cost & Iteration calculator
     ===================================================================== */
  const Cost = (() => {
    let binder;
    function fillSelect(sel, items, wanted) {
      sel.replaceChildren(...items.map(([v, t]) => h('option', { value: v, text: t })));
      sel.value = items.some(([v]) => v === wanted) ? wanted : items[items.length - 1][0];
      return sel.value;
    }
    function resItems(model) { return Object.keys(MODELS[model].std).map((r) => [r, `${r}p`]); }

    function syncSelects() {
      const c = S.cost;
      c.draftRes = fillSelect($('#costDraftRes'), resItems(c.draftModel), c.draftRes);
      c.heroRes = fillSelect($('#costHeroRes'), resItems(c.heroModel), c.heroRes);
    }

    function calc(c) {
      const shots = Math.max(1, Math.ceil(c.runtime / c.shot));
      const dUse = !!(c.refOn && c.refDraft && MODELS[c.draftModel].ref);
      const hUse = !!(c.refOn && c.refHero && MODELS[c.heroModel].ref);
      const dRate = rate(c.draftModel, c.draftRes, dUse);
      const hRate = rate(c.heroModel, c.heroRes, hUse);
      const dBilled = dUse ? c.shot + c.refLen : c.shot;
      const hBilled = hUse ? c.shot + c.refLen : c.shot;
      const dPer = dRate * dBilled;
      const hPer = hRate * hBilled;
      const dGens = shots * c.draftTakes;
      const hGens = shots * c.heroTakes;
      const draft = dGens * dPer;
      const hero = hGens * hPer;
      const images = shots * c.keyPerShot + c.extraImgs;
      const key = images * c.sdPrices[c.sdTier];
      const total = draft + hero + key;
      const heroKept = c.heroTakes > 0 ? hero / c.heroTakes : 0;
      const heroWaste = hero - heroKept;
      const waste = draft + heroWaste;
      const finalCut = heroKept + key;
      const minutes = c.runtime / 60;
      const heroOnly = (c.draftTakes + c.heroTakes) * shots * hPer + key;
      return { shots, dUse, hUse, dRate, hRate, dBilled, hBilled, dPer, hPer, dGens, hGens, draft, hero, images, key, total, heroKept, heroWaste, waste, finalCut, minutes, heroOnly,
        perMin: total / minutes, perFinalSec: total / c.runtime, draftSecs: dGens * c.shot, heroSecs: hGens * c.shot };
    }

    function stack(parts, label) {
      const sum = parts.reduce((a, p) => a + p.v, 0) || 1;
      return `<div class="stack" role="img" aria-label="${esc(label)}">${parts.map((p) => `<span class="${p.c}" style="width:${(p.v / sum) * 100}%"></span>`).join('')}</div>
        <ul class="legend">${parts.map((p) => `<li><span class="sw ${p.c}"></span>${esc(p.t)} <b>${usd(p.v)}</b> · ${nf1.format((p.v / sum) * 100)}%</li>`).join('')}</ul>`;
    }

    function render() {
      const c = S.cost;
      const r = calc(c);
      const bad = !Number.isFinite(r.dRate) || !Number.isFinite(r.hRate);
      const notes = [];
      if (c.refOn && c.refDraft && !MODELS[c.draftModel].ref) notes.push(`${MODELS[c.draftModel].name} has no published reference-clip rate — standard rate applied to drafts.`);
      if (c.refOn && c.refHero && !MODELS[c.heroModel].ref) notes.push(`${MODELS[c.heroModel].name} has no published reference-clip rate — standard rate applied to hero shots.`);
      if (c.runtime < 300 || c.runtime > 420) notes.push('Runtime is outside the 5:00–7:00 competition window.');
      const saving = r.heroOnly - r.total;
      const rows = [
        ['Phase 1 · Drafts', `${MODELS[c.draftModel].name} ${c.draftRes}p${r.dUse ? ' (ref)' : ''}`, r.dRate, r.dBilled, r.dGens, r.draft],
        ['Phase 2 · Hero', `${MODELS[c.heroModel].name} ${c.heroRes}p${r.hUse ? ' (ref)' : ''}`, r.hRate, r.hBilled, r.hGens, r.hero],
        ['Phase 3 · Keyframes', `${SEEDREAM[c.sdTier].name}`, c.sdPrices[c.sdTier], 1, r.images, r.key]
      ];
      $('#costResults').innerHTML = bad ? `<div class="empty"><strong>Pick a resolution this model supports</strong></div>` : `
        <section class="card" aria-label="Estimated total">
          <div class="kpis">
            <div class="kpi big"><div class="k">Total estimated spend</div><div class="v">${usd(r.total)}</div></div>
            <div class="kpi"><div class="k">Burn per final minute</div><div class="v">${usd(r.perMin)}</div></div>
            <div class="kpi"><div class="k">Cost per final second</div><div class="v">${usd(r.perFinalSec)}</div></div>
            <div class="kpi"><div class="k">Shots in final cut</div><div class="v">${r.shots}</div></div>
          </div>
        </section>
        <section class="card"><h2>Spend by phase</h2>
          ${stack([{ c: 'c1', t: 'Drafts', v: r.draft }, { c: 'c2', t: 'Hero shots', v: r.hero }, { c: 'c3', t: 'Keyframes', v: r.key }], 'Spend by phase')}
        </section>
        <section class="card"><h2>Draft waste vs. final cut</h2>
          ${stack([{ c: 'c5', t: 'Draft waste', v: r.waste }, { c: 'c2', t: 'Final cut spend', v: r.finalCut }], 'Draft waste versus final cut spend')}
          <p class="muted small-text">Waste = all draft spend + discarded hero takes. Final cut = kept hero takes + keyframes.</p>
        </section>
        <section class="card"><h2>Line items</h2>
          <div class="table-wrap"><table>
            <thead><tr><th>Phase</th><th class="n">Rate</th><th class="n">Billed s</th><th class="n">Gens</th><th class="n">Cost</th></tr></thead>
            <tbody>${rows.map((x, i) => `<tr><td>${esc(x[0])}<br><span class="muted">${esc(x[1])}</span></td><td class="n">${i < 2 ? usd(x[2], 3) + '/s' : usd(x[2], 3) + '/img'}</td><td class="n">${i < 2 ? x[3] : '—'}</td><td class="n">${nf.format(x[4])}</td><td class="n">${usd(x[5])}</td></tr>`).join('')}</tbody>
          </table></div>
          <p class="muted small-text">Generated: ${num(r.draftSecs)} s of drafts and ${num(r.heroSecs)} s of hero footage for a ${mmss(c.runtime)} film.</p>
        </section>
        <section class="card"><h2>Is drafting worth it?</h2>
          <p>Doing every iteration at hero quality would cost <strong>${usd(r.heroOnly)}</strong>. Your draft-first plan costs <strong>${usd(r.total)}</strong> — ${saving >= 0 ? `saving <strong>${usd(saving)}</strong>` : `<strong>${usd(-saving)}</strong> more`}.</p>
          ${notes.length ? `<ul class="notes">${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}
        </section>
        <details class="card"><summary>Seedance rate card (USD per second)</summary>
          <div class="table-wrap" style="margin-top:12px"><table>
            <thead><tr><th>Model</th><th class="n">480p</th><th class="n">720p</th><th class="n">1080p</th></tr></thead>
            <tbody>${Object.values(MODELS).map((m) => `<tr><td>${esc(m.name)}</td>${[480, 720, 1080].map((res) => `<td class="n">${m.std[res] !== undefined ? usd(m.std[res], 3) : '—'}${m.ref && m.ref[res] !== undefined ? `<br><span class="muted">ref ${usd(m.ref[res], 3)}</span>` : ''}</td>`).join('')}</tr>`).join('')}</tbody>
          </table></div>
        </details>`;
    }

    function init() {
      const c = S.cost;
      fillSelect($('#costDraftModel'), [['s20m', MODELS.s20m.name], ['s20f', MODELS.s20f.name]], c.draftModel);
      fillSelect($('#costHeroModel'), [['s20', MODELS.s20.name], ['s25', MODELS.s25.name]], c.heroModel);
      fillSelect($('#costSdTier'), Object.entries(SEEDREAM).map(([k, v]) => [k, v.name]), c.sdTier);
      syncSelects();
      binder = bindPanel($('#costPanel'), (key) => {
        if (key === 'cost.draftModel' || key === 'cost.heroModel') { syncSelects(); }
        render();
      });
      binder.refresh();
      $('#costReset').addEventListener('click', () => {
        S.cost = costDefaults();
        fillSelect($('#costDraftModel'), [['s20m', MODELS.s20m.name], ['s20f', MODELS.s20f.name]], S.cost.draftModel);
        fillSelect($('#costHeroModel'), [['s20', MODELS.s20.name], ['s25', MODELS.s25.name]], S.cost.heroModel);
        fillSelect($('#costSdTier'), Object.entries(SEEDREAM).map(([k, v]) => [k, v.name]), S.cost.sdTier);
        syncSelects(); binder.refresh(); render(); persist();
        toast('Cost calculator reset');
      });
      render();
    }
    return { init, calc };
  })();

  /* =====================================================================
     8. Module 3 — 70% compliance & timeline validator
     ===================================================================== */
  const Compliance = (() => {
    let binder;
    function evaluate(c) {
      const total = c.seedance + c.other + c.titles;
      const pct = total > 0 ? (c.seedance / total) * 100 : 0;
      const needSeedance = Math.ceil((7 / 3) * (c.other + c.titles));
      const missing = Math.max(0, needSeedance - c.seedance);
      const maxOther = Math.max(0, Math.floor((3 / 7) * c.seedance) - c.other - c.titles);
      const hiRes = ['1080p', '1440p', '4k'].includes(c.res);
      const items = [
        { ok: total >= 300 && total <= 420, t: 'Runtime 5:00–7:00', d: `300 s ≤ ${total} s (${mmss(total)}) ≤ 420 s${total < 300 ? ` — add ${300 - total} s` : total > 420 ? ` — trim ${total - 420} s` : ''}` },
        { ok: total > 0 && pct >= 70, t: 'At least 70.0% Seedance', d: `${nf1.format(pct)}% of runtime is Seedance${missing > 0 ? ` — need ${missing} more Seedance seconds (or cut ${Math.ceil(missing * 0.3)}+ s of other footage)` : ''}` },
        { ok: c.aspect === '16:9' && hiRes && (c.container === 'mp4' || c.container === 'mov'), t: '16:9 · 1080p+ · .MP4 / .MOV',
          d: `${c.aspect}${c.aspect === '16:9' ? '' : ' ✗'} · ${c.res.toUpperCase()}${hiRes ? '' : ' ✗ (min 1080p)'} · .${c.container.toUpperCase()}${c.container === 'mp4' || c.container === 'mov' ? '' : ' ✗ (use MP4 or MOV)'}` },
        { ok: c.subs !== 'none', t: 'English (EN) subtitles ready', d: c.subs === 'none' ? 'Export an English SRT or burn subtitles into the picture' : { srt: 'SRT sidecar prepared', burned: 'Burned-in subtitles prepared', both: 'SRT and burned-in prepared' }[c.subs] },
        { ok: !!c.theme, t: 'Official theme selected (01–05)', d: c.theme ? `${c.theme} · ${THEMES.find((x) => x[0] === c.theme)[1]}` : 'Choose one of the five official themes' }
      ];
      return { total, pct, missing, maxOther, items };
    }

    function render() {
      const c = S.comp;
      const r = evaluate(c);
      const scale = Math.max(420, r.total);
      const seg = (v) => `${(v / scale) * 100}%`;
      $('#tlTrack').innerHTML = `<span class="c2" style="width:${seg(c.seedance)}" title="Seedance">${c.seedance >= 40 ? 'Seedance' : ''}</span><span class="c1" style="width:${seg(c.other)}" title="Other">${c.other >= 40 ? 'Other' : ''}</span><span class="c3" style="width:${seg(c.titles)}" title="Titles">${c.titles >= 30 ? 'Titles' : ''}</span>`;
      $('#tlTrack').setAttribute('aria-label', `Timeline: ${mmss(r.total)} total — Seedance ${c.seedance} s, other ${c.other} s, titles and credits ${c.titles} s`);
      const zone = $('#tlZone');
      zone.style.left = seg(300);
      zone.style.width = `calc(${seg(420)} - ${seg(300)})`;
      const ticks = [[0, '0:00', ''], [300, '5:00', ''], [420, '7:00', scale === 420 ? 'end' : '']];
      if (scale > 420) ticks.push([scale, mmss(scale), 'end']);
      $('#tlTicks').innerHTML = ticks.map(([v, t, cls]) => `<span class="${cls}" style="left:${seg(v)}">${t}</span>`).join('');
      $('#tlLegend').innerHTML = `<li><span class="sw c2"></span>Seedance <b>${c.seedance}s</b></li><li><span class="sw c1"></span>Other AI / VFX <b>${c.other}s</b></li><li><span class="sw c3"></span>Titles &amp; credits <b>${c.titles}s</b></li><li>Total <b>${mmss(r.total)}</b></li>`;

      const passCount = r.items.filter((i) => i.ok).length;
      const all = passCount === r.items.length;
      $('#compVerdict').innerHTML = `<div class="verdict ${all ? 'pass' : 'fail'}" role="status"><span style="font-size:1.5rem" aria-hidden="true">${all ? '✓' : '!'}</span><span>${all ? 'All checks pass — ready for final review' : `${passCount} of ${r.items.length} checks pass`}</span></div>`;
      $('#pctBar').innerHTML = `<i style="width:${clamp(r.pct, 0, 100)}%"></i><b style="left:70%" aria-hidden="true"></b><em style="left:70%">70%</em>`;
      $('#pctText').innerHTML = `<p><strong style="font-size:1.75rem">${nf1.format(r.pct)}%</strong> <span class="muted">Seedance of ${mmss(r.total)}</span></p>
        <p class="muted">${r.pct >= 70 ? `You can add up to <b>${r.maxOther}</b> more seconds of other footage and stay at or above 70%.` : `Add <b>${r.missing}</b> Seedance seconds, or remove non-Seedance footage, to reach 70%.`}</p>`;
      $('#compChecklist').innerHTML = r.items.map((i) => `<li class="${i.ok ? 'pass' : 'fail'}"><span class="mark" aria-hidden="true">${i.ok ? '✓' : '✗'}</span><div><strong>${esc(i.t)} <span class="sr-only">${i.ok ? 'passed' : 'not met'}</span></strong><small>${esc(i.d)}</small></div></li>`).join('');
    }

    function renderRoadmap() {
      const now = Date.now();
      const ms = DEADLINE.getTime() - now;
      const days = Math.ceil(ms / 86400000);
      $('#countdown').textContent = ms > 0 ? `${days} day${days === 1 ? '' : 's'} left` : 'Deadline passed';
      $('#countdownSub').textContent = ms > 0 ? 'until the 20 November 2026 submission deadline (Dubai time)' : 'The 20 November 2026 submission deadline has passed. Check the official site for the latest status.';
      const stage = ms > 0 ? 1 : 2; /* highlight the current milestone */
      $('#roadmap').innerHTML = ROADMAP.map(([t, d], i) => `<li class="${i === stage ? 'hot' : ''}"><strong>${esc(t)}</strong><small>${esc(d)}</small></li>`).join('');
    }

    function init() {
      fillThemes();
      binder = bindPanel($('#compPanel'), () => render());
      binder.refresh();
      $('#compBalanced').addEventListener('click', () => { Object.assign(S.comp, { seedance: 270, other: 70, titles: 20 }); binder.refresh(); render(); persist(); });
      $('#compFix').addEventListener('click', () => {
        const r = evaluate(S.comp);
        if (r.pct >= 70) { toast('Already at 70% or above'); return; }
        S.comp.seedance = clamp(S.comp.seedance + r.missing, 0, 420);
        binder.refresh(); render(); persist();
        toast(`Added ${r.missing} Seedance seconds`);
      });
      render();
      renderRoadmap();
    }
    function fillThemes() {
      const sel = $('#compTheme');
      sel.replaceChildren(h('option', { value: '', text: 'Select a theme…' }), ...THEMES.map(([n, t]) => h('option', { value: n, text: `${n} · ${t}` })));
    }
    return { init, render, evaluate };
  })();

  /* =====================================================================
     9. Module 4 — Glossary
     ===================================================================== */
  const Glossary = (() => {
    let cat = 'all';
    let q = '';
    function render() {
      const query = q.trim().toLowerCase();
      const items = GLOSSARY.filter(([t, c, d]) => (cat === 'all' || c === cat) && (!query || t.toLowerCase().includes(query) || d.toLowerCase().includes(query)));
      const list = $('#glossList');
      list.replaceChildren();
      if (!items.length) {
        list.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, h('strong', { text: 'No matching terms' }), h('span', { text: 'Try a different word or clear the category filter.' }),
          h('button', { type: 'button', class: 'btn', text: 'Clear filters', onclick: () => { q = ''; cat = 'all'; $('#glossSearch').value = ''; chips(); render(); } })));
      } else {
        items.forEach(([t, c, d]) => list.append(h('article', { class: 'term' }, h('span', { class: 'badge tag', text: CATS[c] }), h('h3', { text: t }), h('p', { text: d }))));
      }
      $('#glossCount').textContent = `${items.length} of ${GLOSSARY.length} terms`;
    }
    function chips() {
      const wrap = $('#glossChips');
      wrap.replaceChildren(...[['all', 'All'], ...Object.entries(CATS)].map(([k, v]) => h('button', { type: 'button', class: 'chip', 'aria-pressed': String(cat === k), text: v, onclick: () => { cat = k; chips(); render(); } })));
    }
    function init() {
      chips();
      $('#glossSearch').addEventListener('input', (e) => { q = e.target.value; render(); });
      render();
    }
    return { init };
  })();

  /* =====================================================================
     10. Module 5 — PWA asset & PNG icon pack generator
     ===================================================================== */
  const Assets = (() => {
    const SPECS = [
      { file: 'icons/og-image.png', w: 1200, h: 630, src: 'icons/og-image.svg', label: 'Open Graph banner' },
      { file: 'apple-touch-icon.png', w: 180, h: 180, src: 'apple-touch-icon.svg', label: 'Apple touch icon' },
      { file: 'icons/icon-192.png', w: 192, h: 192, src: 'icons/icon-192.svg', label: 'Icon 192' },
      { file: 'icons/icon-512.png', w: 512, h: 512, src: 'icons/icon-512.svg', label: 'Icon 512' },
      { file: 'icons/icon-maskable-192.png', w: 192, h: 192, src: 'icons/icon-maskable-192.svg', label: 'Maskable 192' },
      { file: 'icons/icon-maskable-512.png', w: 512, h: 512, src: 'icons/icon-maskable-512.svg', label: 'Maskable 512' },
      { file: 'icons/icon-72.png', w: 72, h: 72, src: 'icons/icon-512.svg', label: 'Icon 72' },
      { file: 'icons/icon-96.png', w: 96, h: 96, src: 'icons/icon-512.svg', label: 'Icon 96' },
      { file: 'icons/icon-128.png', w: 128, h: 128, src: 'icons/icon-512.svg', label: 'Icon 128' },
      { file: 'icons/icon-144.png', w: 144, h: 144, src: 'icons/icon-512.svg', label: 'Icon 144' },
      { file: 'icons/icon-152.png', w: 152, h: 152, src: 'icons/icon-512.svg', label: 'Icon 152' },
      { file: 'icons/icon-384.png', w: 384, h: 384, src: 'icons/icon-512.svg', label: 'Icon 384' },
      { file: 'icons/favicon-16x16.png', w: 16, h: 16, src: 'favicon.svg', label: 'Favicon 16' },
      { file: 'icons/favicon-32x32.png', w: 32, h: 32, src: 'favicon.svg', label: 'Favicon 32' }
    ];
    const svgCache = new Map();
    let results = []; /* { spec, blob, url } */

    async function svgText(path) {
      if (svgCache.has(path)) return svgCache.get(path);
      const res = await fetch(path, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`Could not load ${path}`);
      const text = await res.text();
      svgCache.set(path, text);
      return text;
    }
    function loadImage(url) {
      return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('SVG failed to decode'));
        img.src = url;
      });
    }
    async function renderPng(spec) {
      const text = await svgText(spec.src);
      const svgUrl = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
      try {
        const img = await loadImage(svgUrl);
        const canvas = document.createElement('canvas');
        canvas.width = spec.w;
        canvas.height = spec.h;
        const ctx = canvas.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, spec.w, spec.h);
        const blob = await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Canvas export failed'))), 'image/png'));
        return blob;
      } finally { URL.revokeObjectURL(svgUrl); }
    }

    /* Minimal ZIP writer (store, no compression) */
    const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(buf) { let c = 0xFFFFFFFF; for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    function makeZip(files) {
      const enc = new TextEncoder();
      const parts = [];
      const central = [];
      let offset = 0;
      const d = new Date();
      const dosTime = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
      const dosDate = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
      files.forEach((f) => {
        const name = enc.encode(f.name);
        const crc = crc32(f.data);
        const lh = new DataView(new ArrayBuffer(30));
        lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true); lh.setUint16(8, 0, true);
        lh.setUint16(10, dosTime, true); lh.setUint16(12, dosDate, true); lh.setUint32(14, crc, true);
        lh.setUint32(18, f.data.length, true); lh.setUint32(22, f.data.length, true); lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
        parts.push(new Uint8Array(lh.buffer), name, f.data);
        const ch = new DataView(new ArrayBuffer(46));
        ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true); ch.setUint16(10, 0, true);
        ch.setUint16(12, dosTime, true); ch.setUint16(14, dosDate, true); ch.setUint32(16, crc, true);
        ch.setUint32(20, f.data.length, true); ch.setUint32(24, f.data.length, true); ch.setUint16(28, name.length, true);
        ch.setUint32(42, offset, true);
        central.push(new Uint8Array(ch.buffer), name);
        offset += 30 + name.length + f.data.length;
      });
      const cdSize = central.reduce((a, p) => a + p.length, 0);
      const end = new DataView(new ArrayBuffer(22));
      end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
      end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
      return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/zip' });
    }

    function renderGrid() {
      const grid = $('#assetGrid');
      grid.replaceChildren();
      results.forEach(({ spec, blob, url }) => {
        grid.append(h('figure', { class: 'asset', style: 'margin:0' },
          h('div', { class: 'thumb' }, h('img', { src: url, alt: `${spec.label} preview`, width: Math.min(spec.w, 112), height: Math.min(spec.h, 112) })),
          h('code', { text: spec.file }),
          h('span', { class: 'dim', text: `${spec.w}×${spec.h} · ${(blob.size / 1024).toFixed(1)} KB` }),
          h('button', { type: 'button', class: 'btn small', text: 'Download', onclick: () => download(spec.file.split('/').pop(), blob) })));
      });
    }

    async function generate() {
      const btn = $('#assetGen');
      const status = $('#assetStatus');
      const prog = $('#assetProg');
      btn.disabled = true;
      results.forEach((r) => URL.revokeObjectURL(r.url));
      results = [];
      try {
        for (let i = 0; i < SPECS.length; i++) {
          status.textContent = `Rendering ${SPECS[i].file} (${i + 1}/${SPECS.length})…`;
          const blob = await renderPng(SPECS[i]);
          results.push({ spec: SPECS[i], blob, url: URL.createObjectURL(blob) });
          prog.style.width = `${((i + 1) / SPECS.length) * 100}%`;
        }
        renderGrid();
        status.textContent = `Done — ${results.length} PNG files ready.`;
        $('#assetZip').disabled = false;
      } catch (e) {
        status.textContent = `${e.message}. Serve the app over http(s) (not file://) so the SVG templates can be loaded.`;
      } finally { btn.disabled = false; }
    }

    async function zip() {
      if (!results.length) return;
      const files = await Promise.all(results.map(async ({ spec, blob }) => ({ name: spec.file, data: new Uint8Array(await blob.arrayBuffer()) })));
      download('1b-ai-calculator-icons.zip', makeZip(files));
    }

    function init() {
      $('#assetGen').addEventListener('click', generate);
      $('#assetZip').addEventListener('click', zip);
      const grid = $('#assetGrid');
      grid.append(h('div', { class: 'empty', style: 'grid-column:1/-1' }, h('strong', { text: 'No PNGs generated yet' }), h('span', { text: '14 files: Open Graph banner, Apple touch icon, 8 app icons, 2 maskable icons and 2 favicons.' })));
    }
    /* exposed for automated build checks */
    window.__AssetPack = { SPECS, renderPng };
    return { init };
  })();

  /* =====================================================================
     11. PWA shell: tabs, theme, install, offline, SW
     ===================================================================== */
  const TABS = ['studio', 'cost', 'compliance', 'glossary', 'assets'];
  function setTab(id, opts = {}) {
    if (!TABS.includes(id)) id = 'studio';
    S.tab = id;
    TABS.forEach((t) => {
      const on = t === id;
      const btn = $(`#tabbtn-${t}`);
      btn.setAttribute('aria-selected', String(on));
      btn.tabIndex = on ? 0 : -1;
      $(`#tab-${t}`).hidden = !on;
    });
    if (opts.focus) $(`#tabbtn-${id}`).focus();
    if (!opts.silent) window.scrollTo({ top: 0 });
    try { const u = new URL(location.href); u.searchParams.set('tab', id); u.searchParams.delete('new'); history.replaceState(null, '', u); } catch (e) { /* ignore */ }
    if (id === 'compliance') Compliance.render();
    persist();
  }

  function initTabs() {
    const bar = $('#tabbar');
    bar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });
    bar.addEventListener('keydown', (e) => {
      const i = TABS.indexOf(S.tab);
      let n = null;
      if (e.key === 'ArrowRight') n = (i + 1) % TABS.length;
      else if (e.key === 'ArrowLeft') n = (i - 1 + TABS.length) % TABS.length;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = TABS.length - 1;
      if (n !== null) { e.preventDefault(); setTab(TABS[n], { focus: true }); }
    });
  }

  function applyTheme(t, remember) {
    document.documentElement.setAttribute('data-theme', t);
    const meta = $('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', t === 'light' ? '#F3F5F8' : '#0D0F12');
    const btn = $('#themeBtn');
    btn.setAttribute('aria-label', t === 'light' ? 'Switch to dark theme' : 'Switch to light theme');
    if (remember) { try { localStorage.setItem('1b-theme', t); } catch (e) { /* ignore */ } }
  }
  function initTheme() {
    applyTheme(document.documentElement.getAttribute('data-theme') || 'dark', false);
    $('#themeBtn').addEventListener('click', () => applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'dark' : 'light', true));
  }

  function renderPartners() {
    const mk = (list) => list.map(([id, name, color]) => `<svg viewBox="0 0 140 44" role="img" aria-label="${esc(name)}" style="color:${color}"><use href="#${id}"/></svg>`).join('');
    $('#digitalPartners').innerHTML = mk(PARTNERS_DIGITAL);
    $('#dubaiPartners').innerHTML = mk(PARTNERS_DUBAI);
    $('#footerPartners').innerHTML = mk([...PARTNERS_DIGITAL.slice(0, 5), ...PARTNERS_DUBAI.slice(0, 3)]);
  }

  function initDialogs() {
    const partners = $('#partnersDlg');
    $('#partnersBtn').addEventListener('click', () => partners.showModal());
    $$('dialog').forEach((d) => {
      d.addEventListener('click', (e) => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    });
  }

  function setOnline() {
    const on = navigator.onLine;
    const pill = $('#netPill');
    pill.classList.toggle('offline', !on);
    $('#netText').textContent = on ? 'Online' : 'Offline';
    $('#netSr').textContent = on ? ' — connected' : ' — working offline; your data stays on this device';
  }

  let deferredPrompt = null;
  const isStandalone = () => window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  const isIOS = () => /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  function dismissedRecently() { try { return Date.now() - Number(localStorage.getItem('1b-install-dismissed') || 0) < 7 * 86400000; } catch (e) { return false; } }

  function initInstall() {
    const bar = $('#installBar');
    const btn = $('#installBtn');
    const showBar = () => { if (!isStandalone() && !dismissedRecently()) bar.hidden = false; };
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredPrompt = e;
      btn.hidden = false;
      setTimeout(showBar, 15000);
    });
    window.addEventListener('appinstalled', () => { deferredPrompt = null; bar.hidden = true; btn.hidden = true; toast('Installed — find it on your home screen'); });
    if (isIOS() && !isStandalone()) { btn.hidden = false; setTimeout(showBar, 20000); }
    const go = async () => {
      if (deferredPrompt) {
        deferredPrompt.prompt();
        await deferredPrompt.userChoice.catch(() => {});
        deferredPrompt = null; btn.hidden = true; bar.hidden = true;
      } else if (isIOS()) { bar.hidden = true; $('#iosDlg').showModal(); }
    };
    btn.addEventListener('click', go);
    $('#installYes').addEventListener('click', go);
    $('#installNo').addEventListener('click', () => { bar.hidden = true; try { localStorage.setItem('1b-install-dismissed', String(Date.now())); } catch (e) { /* ignore */ } });
  }

  function initServiceWorker() {
    if (!('serviceWorker' in navigator) || location.protocol === 'file:') return;
    let refreshing = false;
    let reg = null;
    const bar = $('#updateBar');
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (refreshing) location.reload(); });
    navigator.serviceWorker.register('sw.js').then((r) => {
      reg = r;
      if (r.waiting && navigator.serviceWorker.controller) bar.hidden = false;
      r.addEventListener('updatefound', () => {
        const nw = r.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => { if (nw.state === 'installed' && navigator.serviceWorker.controller) bar.hidden = false; });
      });
    }).catch(() => { /* SW unavailable — app still works online */ });
    $('#updateBtn').addEventListener('click', () => {
      refreshing = true;
      if (reg && reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
      else location.reload();
    });
    $('#updateLater').addEventListener('click', () => { bar.hidden = true; });
  }

  function syncHeaderHeight() {
    const hd = $('#appHeader');
    const set = () => document.documentElement.style.setProperty('--hdr-h', `${hd.offsetHeight}px`);
    set();
    if ('ResizeObserver' in window) new ResizeObserver(set).observe(hd); else window.addEventListener('resize', set);
  }

  /* =====================================================================
     12. Boot
     ===================================================================== */
  async function boot() {
    const stored = await loadStored();
    mergeState(stored);
    const params = new URLSearchParams(location.search);
    const wantsNew = params.get('new') === '1';
    const tab = params.get('tab') || S.tab;

    initTheme();
    initTabs();
    initDialogs();
    renderPartners();
    syncHeaderHeight();

    Studio.init();
    Cost.init();
    Compliance.init();
    Glossary.init();
    Assets.init();

    if (wantsNew) Studio.loadPreset('starter');
    setTab(tab, { silent: true });

    setOnline();
    window.addEventListener('online', setOnline);
    window.addEventListener('offline', setOnline);

    initInstall();
    initServiceWorker();
    document.documentElement.dataset.ready = 'true';
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
