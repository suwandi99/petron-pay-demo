/* Webhook back office: lists the Adyen events stored by /api/webhooks/adyen. */
(() => {
  const { esc } = window.Demo;
  const $ = (s) => document.querySelector(s);

  let events = [];
  let cursor = null;
  let selected = null;
  let selectedJson = '';
  let timer = null;

  const SIG = {
    valid: ['ok', 'Valid'],
    invalid: ['bad', 'INVALID'],
    'no-signature': ['warn', 'No signature'],
    'no-key': ['off', 'Not checked (no HMAC key set)'],
  };

  const getPw = (force) => {
    let pw = sessionStorage.getItem('wh_pw');
    if (!pw || force) {
      pw = prompt('Back office password (WEBHOOK_VIEW_PASSWORD)') || '';
      if (pw) sessionStorage.setItem('wh_pw', pw);
    }
    return pw;
  };

  async function call(path, method = 'GET', retry = true) {
    const pw = getPw(false);
    if (!pw) throw Object.assign(new Error('A password is required'), { code: 'auth' });
    const res = await fetch(path, { method, headers: { 'x-admin-password': pw } });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && retry) {
      sessionStorage.removeItem('wh_pw');
      getPw(true);
      return call(path, method, false);
    }
    if (!res.ok) throw Object.assign(new Error(data.error || res.statusText), { code: data.code, status: res.status });
    return data;
  }

  const money = (v, cur) => {
    if (v === undefined || !cur) return '–';
    try {
      const nf = new Intl.NumberFormat('en-MY', { style: 'currency', currency: cur });
      return nf.format(v / 10 ** nf.resolvedOptions().maximumFractionDigits);
    } catch {
      return `${cur} ${v}`;
    }
  };
  const when = (iso) => (iso ? new Date(iso).toLocaleString('en-MY', { hour12: false }) : '–');
  const notice = (msg, err = true) => ($('#notice').innerHTML = msg ? `<div class="banner ${err ? 'err' : ''}">${esc(msg)}</div>` : '');
  const sigPill = (s) => {
    const [cls, label] = SIG[s] || ['off', s || '–'];
    return `<span class="pill ${cls}">${esc(label)}</span>`;
  };

  function render() {
    const q = $('#q').value.trim().toLowerCase();
    const code = $('#codeFilter').value;
    const rows = events.filter(
      (e) =>
        (!code || e.code === code) &&
        (!q || [e.code, e.psp, e.orig, e.ref, e.mid, e.reason, e.pm].some((x) => String(x || '').toLowerCase().includes(q)))
    );
    $('#meta').textContent = `${rows.length} shown of ${events.length} loaded`;
    $('#rows').innerHTML = rows.length
      ? rows
          .map(
            (e) => `<tr data-k="${esc(e.key)}" class="${selected === e.key ? 'on' : ''}">
              <td>${esc(when(e.rt))}</td>
              <td><b>${esc(e.code || e.fmt)}</b>${e.live ? ' <span class="pill warn">live</span>' : ''}</td>
              <td>${e.ok === true ? '<span class="pill ok">success</span>' : e.ok === false ? '<span class="pill bad">failed</span>' : '–'}${e.reason ? `<div class="muted">${esc(e.reason)}</div>` : ''}</td>
              <td>${esc(e.psp || '–')}${e.orig ? `<div class="muted">orig ${esc(e.orig)}</div>` : ''}</td>
              <td>${esc(e.ref || '–')}</td>
              <td>${esc(money(e.v, e.cur))}</td>
              <td>${sigPill(e.sig)}</td></tr>`
          )
          .join('')
      : `<tr><td colspan="7" class="muted" style="padding:18px">No events yet. Send a test from Adyen (Developers → Webhooks → your webhook → Test configuration), or make a payment in the demo.</td></tr>`;
    $('#rows').querySelectorAll('tr[data-k]').forEach((tr) => (tr.onclick = () => openDetail(tr.dataset.k)));
    $('#more').hidden = !cursor;
  }

  function fillCodes() {
    const sel = $('#codeFilter');
    const cur = sel.value;
    const codes = [...new Set(events.map((e) => e.code).filter(Boolean))].sort();
    sel.innerHTML = '<option value="">All events</option>' + codes.map((c) => `<option ${c === cur ? 'selected' : ''}>${esc(c)}</option>`).join('');
  }

  async function load(more = false) {
    try {
      const data = await call('/api/webhooks/list?limit=200' + (more && cursor ? '&cursor=' + encodeURIComponent(cursor) : ''));
      events = more ? events.concat(data.events) : data.events;
      cursor = data.cursor;
      const c = data.config;
      $('#cfg').textContent = `HMAC keys configured: ${c.hmacKeysConfigured} · Basic auth: ${c.basicAuthConfigured ? 'on' : 'off'} · Events kept for ${c.retentionDays} days. New events can take up to a minute to appear.`;
      notice(c.hmacKeysConfigured ? '' : 'No ADYEN_HMAC_KEY is set, so signatures are not being checked. Anyone who knows the URL could post fake events.', true);
      fillCodes();
      render();
    } catch (e) {
      if (e.code === 'no-kv' || e.code === 'no-password') notice(e.message);
      else if (e.code !== 'auth') notice('Could not load events: ' + e.message);
      else notice(e.message);
    }
  }

  async function openDetail(key) {
    selected = key;
    render();
    $('#detailCard').hidden = false;
    $('#detailJson').textContent = 'Loading…';
    try {
      const rec = await call('/api/webhooks/event?key=' + encodeURIComponent(key));
      const p = rec.payload || {};
      selectedJson = JSON.stringify(p, null, 2);
      $('#detailTitle').textContent = p.eventCode || p.type || 'Event';
      $('#detailKv').innerHTML =
        `<dt>Received</dt><dd>${esc(when(rec.receivedAt))}</dd>` +
        `<dt>Signature</dt><dd>${sigPill(rec.signature)}</dd>` +
        (rec.headers?.hmacsignature ? `<dt>hmacsignature header</dt><dd>${esc(rec.headers.hmacsignature)}</dd>` : '') +
        (rec.headers?.['user-agent'] ? `<dt>Sent by</dt><dd>${esc(rec.headers['user-agent'])}</dd>` : '');
      $('#detailJson').textContent = selectedJson;
      $('#detailCard').scrollIntoView?.({ behavior: 'smooth', block: 'nearest' });
    } catch (e) {
      $('#detailJson').textContent = e.message;
    }
  }

  function setupTimer() {
    clearInterval(timer);
    if ($('#auto').checked) timer = setInterval(() => !document.hidden && load(false), 6000);
  }

  $('#endpoint').textContent = location.origin + '/api/webhooks/adyen';
  $('#copy').onclick = () => navigator.clipboard?.writeText($('#endpoint').textContent).then(() => ($('#copy').textContent = 'Copied'), () => {});
  $('#copyJson').onclick = () => navigator.clipboard?.writeText(selectedJson);
  $('#refresh').onclick = () => load(false);
  $('#more').onclick = () => load(true);
  $('#q').oninput = render;
  $('#codeFilter').onchange = render;
  $('#auto').onchange = setupTimer;
  $('#clear').onclick = async () => {
    if (!confirm('Delete ALL stored webhook events?')) return;
    try {
      await call('/api/webhooks/clear', 'POST');
      selected = null;
      $('#detailCard').hidden = true;
      await load(false);
    } catch (e) {
      notice(e.message);
    }
  };

  load(false);
  setupTimer();
})();
