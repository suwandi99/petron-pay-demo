/* Station POS – merchant-side view of the pre-authorised fuel payments.
   Shows how a pre-auth is later captured in full, partially, above the hold (adjust + capture), or released. */
(() => {
  const D = window.Demo;
  const { esc, rm } = D;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  let selectedId = null;
  let busy = false;
  let logs = {}; // holdId -> array of call records (kept for this page view)

  const statusPill = (h) =>
    ({
      authorised: '<span class="pill hold">Hold active</span>',
      captured: '<span class="pill ok">Captured</span>',
      released: '<span class="pill off">Released</span>',
    }[h.status] || '');

  function renderList() {
    const holds = D.get().holds;
    if (!selectedId && holds.length) selectedId = holds[0].id;
    $('#holds').innerHTML = holds.length
      ? holds.map((h) => `<button class="hold-item ${h.id === selectedId ? 'on' : ''}" data-id="${h.id}">
          <div class="row"><b>${esc(h.station)} · Pump ${esc(h.pump)}</b>${statusPill(h)}</div>
          <div class="muted">${esc(h.fuel)} · hold ${rm(h.current)}</div></button>`).join('')
      : '<div class="muted">No holds yet. In the customer app choose <b>Pay at pump</b> and pay with a card.</div>';
    $$('[data-id]').forEach((b) => (b.onclick = () => { selectedId = b.dataset.id; render(); }));
  }

  function renderDetail() {
    const h = D.get().holds.find((x) => x.id === selectedId);
    const box = $('#detail');
    if (!h) { box.innerHTML = '<div class="card muted">Select a hold on the left.</div>'; return; }

    const defaultFinal = Math.round((h.current * 0.62) / 10) * 10;
    const finalVal = h.__draft ?? defaultFinal;
    const litres = (finalVal / h.price).toFixed(2);
    const done = h.status !== 'authorised';

    box.innerHTML = `
      <div class="card">
        <div class="row"><h3 style="margin:0">${esc(h.station)} · Pump ${esc(h.pump)}</h3>${statusPill(h)}</div>
        <dl class="kv" style="margin-top:12px">
          <dt>Fuel</dt><dd>${esc(h.fuel)} · RM ${(h.price / 100).toFixed(2)}/L</dd>
          <dt>Authorised (hold)</dt><dd>${rm(h.current)}${h.current !== h.authorised ? ` <span class="muted">(originally ${rm(h.authorised)})</span>` : ''}</dd>
          <dt>Captured</dt><dd>${h.status === 'captured' ? rm(h.captured) : '–'}</dd>
          <dt>pspReference</dt><dd>${esc(h.psp)}</dd>
        </dl>
      </div>
      <div class="card">
        <h3>Pump finished · final amount</h3>
        <div class="muted">Enter what the customer actually pumped. Below the hold = partial capture. Above the hold = over-capture.</div>
        <label class="fld">Final amount (RM) · ${litres} L</label>
        <input class="txt" id="final" inputmode="decimal" value="${(finalVal / 100).toFixed(2)}" ${done ? 'disabled' : ''} />
        <div class="chips" style="margin:10px 0">
          <button class="chip" data-q="0.5" ${done ? 'disabled' : ''}>50% of hold</button>
          <button class="chip" data-q="1" ${done ? 'disabled' : ''}>Full hold</button>
          <button class="chip" data-q="1.2" ${done ? 'disabled' : ''}>120% (over)</button>
        </div>
        <div class="actions">
          <button class="btn" id="capture" ${done || busy ? 'disabled' : ''}>${captureLabel(h, finalVal)}</button>
          <button class="btn ghost" id="release" ${done || busy ? 'disabled' : ''}>Release hold (pump not used)</button>
        </div>
        ${done ? '' : `<details style="margin-top:12px"><summary class="muted" style="cursor:pointer">Adjust the hold only</summary>
          <div class="row" style="margin-top:8px;gap:8px"><input class="txt" id="adj" inputmode="decimal" placeholder="New total hold (RM)" />
          <button class="btn ghost small" id="adjBtn" ${busy ? 'disabled' : ''}>Adjust</button></div></details>`}
      </div>
      <div class="card"><h3>Adyen API calls</h3><div class="log" id="log">${renderLog(h.id)}</div>
        <div class="muted" style="margin-top:8px">Captures and adjustments are accepted asynchronously (status “received”). Adyen confirms the final result with CAPTURE / AUTHORISATION_ADJUSTMENT webhooks; this demo does not listen for them.</div></div>`;

    const inp = $('#final');
    if (inp) {
      inp.oninput = () => {
        const v = Math.round(parseFloat(inp.value) * 100);
        if (Number.isFinite(v)) { h.__draft = v; $('#capture').textContent = captureLabel(h, v); }
      };
    }
    $$('[data-q]').forEach((b) => (b.onclick = () => {
      const v = Math.round((h.current * Number(b.dataset.q)) / 10) * 10;
      inp.value = (v / 100).toFixed(2); h.__draft = v; $('#capture').textContent = captureLabel(h, v);
    }));
    $('#capture')?.addEventListener('click', () => doCapture(h, parseAmount(inp.value)));
    $('#release')?.addEventListener('click', () => doRelease(h));
    $('#adjBtn')?.addEventListener('click', () => doAdjust(h, parseAmount($('#adj').value)));
  }

  const parseAmount = (v) => Math.round(parseFloat(v) * 100);
  function captureLabel(h, v) {
    if (!Number.isFinite(v) || v <= 0) return 'Capture';
    if (v > h.current) return `Over-capture ${rm(v)} (adjust +${rm(v - h.current)}, then capture)`;
    if (v < h.current) return `Partial capture ${rm(v)}`;
    return `Capture ${rm(v)} (full)`;
  }

  function renderLog(id) {
    const calls = logs[id] || [];
    if (!calls.length) return '<span class="muted" style="color:#8a98b8">API requests and responses appear here.</span>';
    return calls.map((c) => {
      const cls = c.status >= 200 && c.status < 300 ? 'good' : 'bad';
      const secretFree = JSON.stringify({ request: c.request, response: c.response }, null, 2);
      return `<div><span class="ep">${esc(c.endpoint)}</span>  <span class="${cls}">${c.status}</span>  ${esc(c.name)}\n${esc(secretFree)}</div><br>`;
    }).join('');
  }

  async function ensurePin() {
    const cfg = await D.config();
    if (cfg.posPinRequired && !sessionStorage.getItem('pos_pin')) {
      const pin = prompt('Enter the POS PIN for this demo');
      if (!pin) throw new Error('A PIN is required for POS actions');
      sessionStorage.setItem('pos_pin', pin);
    }
  }

  async function run(h, action, amount, onOk) {
    if (busy) return;
    busy = true; render();
    try {
      await ensurePin();
      const res = await D.api('/api/modify', { action, pspReference: h.psp, amount });
      logs[h.id] = [...(logs[h.id] || []), ...res.calls];
      D.update((s) => { const x = s.holds.find((y) => y.id === h.id); onOk(x); });
      notice('');
    } catch (e) {
      if (e.status === 401) sessionStorage.removeItem('pos_pin');
      if (e.data?.calls) logs[h.id] = [...(logs[h.id] || []), ...e.data.calls];
      notice(e.message, true);
    } finally {
      busy = false; render();
    }
  }

  const doCapture = (h, v) => {
    if (!Number.isFinite(v) || v <= 0) return notice('Enter a valid final amount', true);
    if (v > h.current) return run(h, 'overcapture', v, (x) => { x.current = v; x.captured = v; x.status = 'captured'; });
    return run(h, 'capture', v, (x) => { x.captured = v; x.status = 'captured'; });
  };
  const doRelease = (h) => run(h, 'cancel', undefined, (x) => { x.status = 'released'; });
  const doAdjust = (h, v) => {
    if (!Number.isFinite(v) || v <= 0) return notice('Enter a valid new total', true);
    return run(h, 'adjust', v, (x) => { x.current = v; });
  };

  function notice(msg, err) {
    $('#notice').innerHTML = msg ? `<div class="banner ${err ? 'err' : ''}">${esc(msg)}</div>` : '';
  }

  function render() { renderList(); renderDetail(); }
  window.addEventListener('storage', () => { if (!busy) render(); });
  D.config().then((cfg) => { if (!cfg.ready) notice('Adyen is not configured yet. Missing: ' + cfg.missing.join(', '), true); });
  render();
})();
