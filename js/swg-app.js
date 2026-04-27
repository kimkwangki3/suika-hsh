// 공통 인증 + 자산 교체 (cocos2d 인터셉트)

const SWGApp = (() => {
  const K = { U: 'swg_users', S: 'swg_session' };
  async function hash(s) {
    const buf = new TextEncoder().encode(s);
    const h = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(h)).map(b => b.toString(16).padStart(2, '0')).join('');
  }
  const get = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
  const set = (k, v) => localStorage.setItem(k, JSON.stringify(v));

  async function init() {
    const users = get(K.U, []);
    if (!users.find(u => u.u === 'admin')) {
      users.push({ u: 'admin', h: await hash('admin1234'), role: 'admin' });
      set(K.U, users);
    }
  }
  async function login(username, password) {
    if (!username) throw new Error('아이디를 입력하세요');
    const users = get(K.U, []);
    const user = users.find(x => x.u === username);
    if (!user) throw new Error('존재하지 않는 아이디입니다');
    if (user.h !== await hash(password)) throw new Error('비밀번호가 틀립니다');
    set(K.S, { u: user.u, role: user.role });
    return user;
  }
  async function signup(username, password) {
    if (!username) throw new Error('아이디를 입력하세요');
    if (username.length < 2) throw new Error('아이디는 2자 이상');
    const users = get(K.U, []);
    if (users.find(x => x.u === username)) throw new Error('이미 존재하는 아이디입니다');
    const user = { u: username, h: await hash(password || ''), role: 'user' };
    users.push(user); set(K.U, users);
    set(K.S, { u: user.u, role: user.role });
    return user;
  }
  async function guest() {
    const id = 'guest_' + Math.random().toString(36).slice(2, 8);
    set(K.S, { u: id, role: 'user', guest: true });
    return { u: id, role: 'user' };
  }
  function logout() { localStorage.removeItem(K.S); }
  function session() { return get(K.S, null); }
  function require(redirect = 'login.html') {
    const s = session();
    if (!s) { location.href = redirect; return null; }
    return s;
  }
  function requireAdmin() {
    const s = require();
    if (s && s.role !== 'admin') { alert('관리자만 접근 가능합니다'); location.href = 'index.html'; return null; }
    return s;
  }
  function registerSW() {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW:', e));
    }
  }
  return { init, login, signup, guest, logout, session, require, requireAdmin, registerSW };
})();

// ===== 역대 순위 =====
const SWGScore = (() => {
  const K = 'swg_scores';
  const get = () => { try { return JSON.parse(localStorage.getItem(K)) || []; } catch { return []; } };
  const set = (v) => localStorage.setItem(K, JSON.stringify(v));

  function add(username, score) {
    if (!username || !Number.isFinite(score) || score < 0) throw new Error('점수가 올바르지 않습니다');
    const arr = get();
    arr.push({ u: username, s: Math.floor(score), d: Date.now() });
    set(arr);
  }
  function top(limit = 50) {
    return get().sort((a, b) => b.s - a.s).slice(0, limit);
  }
  function myBest(username) {
    const mine = get().filter(x => x.u === username);
    if (!mine.length) return null;
    return mine.reduce((max, x) => x.s > max.s ? x : max);
  }
  function clearAll() { localStorage.removeItem(K); }
  function remove(username, date) {
    const arr = get().filter(x => !(x.u === username && x.d === date));
    set(arr);
  }
  return { add, top, myBest, clearAll, remove };
})();

// =============== 자산 교체 시스템 (Cache API + Image/fetch 후킹) ===============
const SWGAssets = (() => {
  const CACHE = 'swg-asset-overrides-v1';

  async function cacheOpen() { return await caches.open(CACHE); }

  async function set(path, fileOrBlob) {
    const cache = await cacheOpen();
    const blob = fileOrBlob instanceof Blob ? fileOrBlob : new Blob([fileOrBlob]);
    const ct = blob.type || 'image/png';
    await cache.put(path, new Response(blob, { headers: { 'Content-Type': ct } }));
  }
  async function del(path) {
    const cache = await cacheOpen();
    return cache.delete(path);
  }
  async function clear() {
    return caches.delete(CACHE);
  }
  async function listPaths() {
    const cache = await cacheOpen();
    return (await cache.keys()).map(r => decodeURIComponent(new URL(r.url).pathname));
  }
  // 모든 매핑을 path -> blobURL 로 메모리 로드 (게임 시작 시 사용)
  async function loadAll() {
    const map = {};
    try {
      const cache = await cacheOpen();
      const reqs = await cache.keys();
      for (const req of reqs) {
        const path = decodeURIComponent(new URL(req.url).pathname);
        const resp = await cache.match(req);
        if (resp) map[path] = URL.createObjectURL(await resp.blob());
      }
    } catch (e) { console.warn('SWGAssets.loadAll:', e); }
    return map;
  }
  // Image / fetch / XHR 후킹 (cocos2d 시작 전에 호출)
  function installHook(map) {
    if (!map || !Object.keys(map).length) return;
    window.__swgOverrides = map;

    function resolve(value) {
      try {
        const u = new URL(value, location.href);
        const path = decodeURIComponent(u.pathname);
        return map[path] || null;
      } catch { return null; }
    }

    // 1) Image.prototype.src
    const desc = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
    if (desc && desc.configurable) {
      Object.defineProperty(HTMLImageElement.prototype, 'src', {
        configurable: true,
        enumerable: desc.enumerable,
        get() { return desc.get.call(this); },
        set(v) {
          const r = resolve(v);
          desc.set.call(this, r || v);
        }
      });
    }

    // 2) fetch
    const origFetch = window.fetch;
    window.fetch = function(input, init) {
      try {
        const url = typeof input === 'string' ? input : (input && input.url);
        const r = resolve(url);
        if (r) return origFetch(r, init);
      } catch {}
      return origFetch.apply(this, arguments);
    };

    // 3) XHR
    const OrigOpen = XMLHttpRequest.prototype.open;
    XMLHttpRequest.prototype.open = function(method, url) {
      const r = resolve(url);
      arguments[1] = r || url;
      return OrigOpen.apply(this, arguments);
    };
  }

  return { set, del, clear, listPaths, loadAll, installHook };
})();
