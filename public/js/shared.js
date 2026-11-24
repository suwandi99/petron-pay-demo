/* Shared helpers for the customer app (index.html) and the Station POS (pos.html).
   Demo state lives in localStorage so both pages, opened in the same browser, stay in sync. */
window.Demo = (() => {
  // Adyen Web (Drop-in / Components) v6 from Adyen's CDN. Check the latest 6.x version in Adyen's
  // docs and bump this one constant if you want a newer release.
  const ADYEN_WEB_VERSION = '6.30.0';
  const CDN = `https://checkoutshopper-test.cdn.adyen.com/checkoutshopper/sdk/${ADYEN_WEB_VERSION}`;

  const KEY = 'petron_demo_v1';
  const uid = () => Math.random().toString(36).slice(2, 10);

  // One stable shopper reference per browser. It is created once, saved immediately, and only
  // changes when "Reset demo data" is used. (sessionRef keeps it stable even if storage is blocked.)
  let sessionRef = 'petron-demo-' + uid();

  const defaults = () => ({
    shopperRef: sessionRef,
    name: 'Aisyah',
    wallet: 1500, // sen -> RM 15.00, deliberately low so the top-up story makes sense
    txns: [],
    holds: [],
  });

  const read = () => {
    let saved = {};
    try {
      saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    } catch {
      saved = {};
    }
    const state = { ...defaults(), ...saved };
    if (!saved.shopperRef) {
      try { localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* storage blocked: sessionRef still keeps it stable */ }
    }
    return state;
  };

  const get = () => read();
  const update = (fn) => {
    const s = read();
    fn(s);
    localStorage.setItem(KEY, JSON.stringify(s));
    return s;
  };
  const reset = () => {
    sessionRef = 'petron-demo-' + uid(); // a reset deliberately starts a new shopper
    try {
      localStorage.removeItem(KEY);
      localStorage.removeItem('petron_pending');
      localStorage.removeItem('petron_last_addcard');
    } catch { /* ignore */ }
  };

  const rm = (minor) => 'RM ' + (minor / 100).toLocaleString('en-MY', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const esc = (v) =>
    String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  async function api(path, body, method) {
    const headers = { 'content-type': 'application/json' };
    const pin = sessionStorage.getItem('pos_pin');
    if (pin) headers['x-pos-pin'] = pin;
    const res = await fetch(path, {
      method: method || (body === undefined ? 'GET' : 'POST'),
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const e = new Error(data.error || res.statusText || 'Request failed');
      e.status = res.status;
      e.data = data;
      throw e;
    }
    return data;
  }

  let configPromise;
  const config = () => (configPromise ||= api('/api/config'));

  let adyenPromise;
  const loadAdyen = () =>
    (adyenPromise ||= new Promise((resolve, reject) => {
      if (window.AdyenWeb) return resolve();
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = `${CDN}/adyen.css`;
      document.head.appendChild(css);
      const js = document.createElement('script');
      js.src = `${CDN}/adyen.js`;
      js.onload = () => (window.AdyenWeb ? resolve() : reject(new Error('Adyen Web loaded but window.AdyenWeb is missing')));
      js.onerror = () => reject(new Error('Could not load Adyen Web from ' + CDN));
      document.head.appendChild(js);
    }));

  return { get, update, reset, rm, esc, uid, api, config, loadAdyen, ADYEN_WEB_VERSION };
})();
