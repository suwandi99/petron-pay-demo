/* Petron Pay – customer app prototype (mobile-style web app) built on Adyen Web Drop-in / Components v6.
   Flows: pay-at-pump (card pre-authorisation), wallet top-up (non-card), add card (tokenisation). */
(() => {
  const D = window.Demo;
  const { esc, rm } = D;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];

  // ---- mock catalogue (sample data only) -------------------------------------------------------
  const STATIONS = [
    { id: 'st1', name: 'Petron Ampang', area: 'Kuala Lumpur', pumps: 8 },
    { id: 'st2', name: 'Petron Bangsar', area: 'Kuala Lumpur', pumps: 6 },
    { id: 'st3', name: 'Petron Subang Jaya', area: 'Selangor', pumps: 8 },
  ];
  const FUELS = [
    { id: 'ron95', name: 'RON 95', price: 205 },
    { id: 'ron97', name: 'RON 97', price: 347 },
    { id: 'diesel', name: 'Diesel', price: 289 },
  ];
  const HOLD_CHOICES = [5000, 10000, 15000, 20000]; // sen
  const TOPUP_CHOICES = [1000, 2000, 5000, 10000];

  // ---- tiny router ----------------------------------------------------------------------------
  let view = { name: 'home', params: {} };
  let activeComponent = null;
  let draft = { station: STATIONS[0].id, pump: 1, fuel: 'ron95', hold: 10000, topup: 5000 };
  const screens = {};

  function teardown() {
    if (activeComponent) {
      try { activeComponent.unmount(); } catch { /* ignore */ }
      activeComponent = null;
    }
  }
  function go(name, params = {}) {
    teardown();
    view = { name, params };
    paint();
  }
  function paint() {
    const s = screens[view.name];
    $('#screen').innerHTML = s.html(view.params);
    $('#screen').scrollTop = 0;
    $('#title').textContent = typeof s.title === 'function' ? s.title(view.params) : s.title;
    const back = $('#back');
    back.hidden = !s.back;
    back.onclick = () => go(s.back);
    $$('#tabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === (s.tab || view.name)));
    $$('[data-go]').forEach((el) => (el.onclick = () => go(el.dataset.go)));
    if (s.after) s.after(view.params);
  }
  function toast(msg) {
    $('.toast')?.remove();
    const t = document.createElement('div');
    t.className = 'toast';
    t.textContent = msg;
    $('#phone').appendChild(t);
    setTimeout(() => t.remove(), 4500);
  }
  const banner = (msg, err) => `<div class="banner ${err ? 'err' : ''}">${esc(msg)}</div>`;
  // Remember the outcome of the last add-card attempt so the Cards screen can show it (toasts vanish).
  const noteAddCard = (o) => {
    try { localStorage.setItem('petron_last_addcard', JSON.stringify({ ...o, ts: Date.now() })); } catch { /* ignore */ }
  };

  // ---- Adyen plumbing ---------------------------------------------------------------------------
  // Builds one AdyenCheckout instance (Advanced flow: we call /payments ourselves so we get the
  // pspReference back, which the Station POS needs for capture/adjust/cancel).
  async function buildCheckout({ kind, amount, meta }) {
    const cfg = await D.config();
    if (!cfg.ready) throw new Error('Adyen is not configured yet. Missing: ' + cfg.missing.join(', '));
    await D.loadAdyen();
    const scope = kind === 'topup' ? 'topup' : kind === 'addcard' ? 'addcard' : 'card';
    const methods = await D.api('/api/payment-methods', { scope, amount: { value: amount }, shopperReference: D.get().shopperRef });
    const { AdyenCheckout } = window.AdyenWeb;
    const last = {};

    const checkout = await AdyenCheckout({
      environment: cfg.environment,
      clientKey: cfg.clientKey,
      countryCode: 'MY',
      locale: 'en-US',
      amount: { value: amount, currency: 'MYR' },
      paymentMethodsResponse: methods,

      onSubmit: async (state, component, actions) => {
        try {
          // Remember what we were doing in case the shopper is redirected away (FPX, e-wallets).
          localStorage.setItem('petron_pending', JSON.stringify({ kind, amount, meta }));
          const res = await D.api('/api/payments', { data: state.data, kind, amount, shopperReference: D.get().shopperRef });
          if (res.pspReference) last.pspReference = res.pspReference;
          if (kind === 'addcard') noteAddCard({ stage: '/payments', resultCode: res.resultCode, pspReference: res.pspReference, refusalReason: res.refusalReason, action: res.action?.type });
          if (!res.resultCode) return actions.reject();
          actions.resolve({ resultCode: res.resultCode, action: res.action, order: res.order, donationToken: res.donationToken });
        } catch (e) {
          if (kind === 'addcard') noteAddCard({ stage: '/payments', error: e.data?.details?.message || e.data?.details?.errorCode || e.message });
          toast(e.message);
          actions.reject();
        }
      },
      onAdditionalDetails: async (state, component, actions) => {
        try {
          const res = await D.api('/api/payments-details', { data: state.data });
          if (res.pspReference) last.pspReference = res.pspReference;
          if (!res.resultCode) return actions.reject();
          actions.resolve({ resultCode: res.resultCode, action: res.action, order: res.order, donationToken: res.donationToken });
        } catch (e) {
          toast(e.message);
          actions.reject();
        }
      },
      onPaymentCompleted: (result) => complete({ kind, amount, meta, resultCode: result.resultCode, pspReference: last.pspReference }),
      onPaymentFailed: (result) => complete({ kind, amount, meta, resultCode: result?.resultCode || 'Refused', pspReference: last.pspReference }),
      onError: (error) => {
        if (kind === 'addcard') noteAddCard({ stage: 'browser (Adyen Web)', error: error?.message || String(error) });
        toast(error?.message || 'Something went wrong with the payment');
      },
    });
    return { checkout, methods };
  }

  // Mounts Drop-in (cards only for the pump, non-card methods only for top-up) into `el`.
  async function mountDropin(el, opts) {
    el.innerHTML = '<div class="spinner"></div>';
    try {
      const { checkout, methods } = await buildCheckout(opts);
      const nothing = !(methods.paymentMethods || []).length && !(methods.storedPaymentMethods || []).length;
      if (nothing) {
        el.innerHTML = banner(
          opts.kind === 'topup'
            ? 'No top-up payment methods are enabled on this Adyen test account yet (card, DuitNow QR, FPX or an e-wallet). Enable one in the Customer Area, or adjust TOPUP_METHODS.'
            : 'No card payment method is enabled on this Adyen test account.',
          true
        );
        return;
      }
      el.innerHTML = '';
      const { Dropin } = window.AdyenWeb;
      const dropin = new Dropin(checkout, {
        showStoredPaymentMethods: true,
        paymentMethodsConfiguration: {
          card: { hasHolderName: true, holderNameRequired: false, enableStoreDetails: opts.kind === 'preauth' || opts.kind === 'topup' },
        },
      });
      dropin.mount(el);
      activeComponent = dropin;
    } catch (e) {
      el.innerHTML = banner(e.message, true);
    }
  }

  // ---- what to do when a payment finishes -----------------------------------------------------
  function complete({ kind, amount, meta, resultCode, pspReference }) {
    localStorage.removeItem('petron_pending');
    const ok = resultCode === 'Authorised';
    const waiting = ['Pending', 'Received', 'PresentToShopper'].includes(resultCode);
    const now = Date.now();

    if (kind === 'topup') {
      if (ok) {
        D.update((s) => {
          s.wallet += amount;
          s.txns.unshift({ id: D.uid(), type: 'topup', title: 'Wallet top-up', amount, status: 'success', ts: now, psp: pspReference });
        });
        return go('result', { icon: '✅', title: 'Top-up successful', text: `${rm(amount)} has been added to your Petron Pay wallet.`, cta: ['Back to home', 'home'] });
      }
      if (waiting) {
        D.update((s) => s.txns.unshift({ id: D.uid(), type: 'topup', title: 'Wallet top-up', amount, status: 'pending', ts: now, psp: pspReference }));
        return go('result', { icon: '⏳', title: 'Payment processing', text: 'We are waiting for the final confirmation. Your wallet will update once it clears.', cta: ['Back to home', 'home'] });
      }
      return go('result', { icon: '❌', title: 'Top-up failed', text: `The payment was not completed (${resultCode}). You can try again.`, cta: ['Try again', 'topup'] });
    }

    if (kind === 'preauth') {
      if (ok && pspReference) {
        const st = STATIONS.find((x) => x.id === meta.station);
        const fuel = FUELS.find((x) => x.id === meta.fuel);
        D.update((s) =>
          s.holds.unshift({
            id: D.uid(), psp: pspReference, station: st.name, pump: meta.pump, fuel: fuel.name, price: fuel.price,
            authorised: amount, current: amount, captured: 0, status: 'authorised', ts: now,
          })
        );
        return go('result', {
          icon: '⛽', title: `Pump ${meta.pump} is ready`,
          text: `We placed a ${rm(amount)} hold on your card. You will only be charged for the fuel you actually pump.`,
          cta: ['View my holds', 'activity'], link: ['Open Station POS (merchant view)', '/pos.html'],
        });
      }
      return go('result', { icon: '❌', title: 'Card not authorised', text: `The pre-authorisation was not approved (${resultCode}). Try another card.`, cta: ['Try again', 'pumpPay'] });
    }

    if (kind === 'addcard') {
      if (ok) {
        toast('Card saved to your account');
        return go('cards');
      }
      return go('result', { icon: '❌', title: 'Could not save card', text: `The card was not accepted (${resultCode}).`, cta: ['Try again', 'addCard'] });
    }
  }

  // ---- screens ------------------------------------------------------------------------------------
  screens.home = {
    title: 'Petron Pay', tab: 'home',
    html() {
      const s = D.get();
      const active = s.holds.filter((h) => h.status === 'authorised');
      return `
        <div class="wallet">
          <div class="lbl">Hi ${esc(s.name)} · Petron Pay wallet</div>
          <div class="amt">${rm(s.wallet)}</div>
          <button class="btn" data-go="topup">Top up</button>
        </div>
        <div class="tiles">
          <button class="tile" data-go="pump"><div class="ic">⛽</div><div class="t">Pay at pump</div><div class="s">Hold, then pay for what you pump</div></button>
          <button class="tile" data-go="topup"><div class="ic">📲</div><div class="t">Top up</div><div class="s">DuitNow QR, FPX, e-wallets</div></button>
          <button class="tile" data-go="cards"><div class="ic">💳</div><div class="t">My cards</div><div class="s">Add or manage cards</div></button>
          <button class="tile" data-go="activity"><div class="ic">🧾</div><div class="t">Activity</div><div class="s">Holds and receipts</div></button>
        </div>
        ${active.length ? `<div class="card"><h3>Active fuel holds</h3>${active.map(holdRow).join('')}</div>` : ''}
        <div class="hint">Demo build. Sample stations and prices; payments run against the Adyen <b>test</b> environment.</div>`;
    },
  };

  const holdRow = (h) => `
    <div class="list-item"><div><div class="t">${esc(h.station)} · Pump ${esc(h.pump)}</div>
    <div class="muted">${esc(h.fuel)} · ${esc(new Date(h.ts).toLocaleString('en-MY'))}</div></div>
    <div style="text-align:right"><div class="t">${rm(h.status === 'captured' ? h.captured : h.current)}</div>${holdPill(h)}</div></div>`;
  const holdPill = (h) =>
    ({
      authorised: '<span class="pill hold">Hold active</span>',
      captured: '<span class="pill ok">Charged</span>',
      released: '<span class="pill off">Hold released</span>',
    }[h.status] || '');

  screens.pump = {
    title: 'Pay at pump', tab: 'pump',
    html() {
      const price = FUELS.find((f) => f.id === draft.fuel).price;
      return `
        <div class="card"><h3>1 · Station</h3>
          ${STATIONS.map((st) => `<button class="option ${draft.station === st.id ? 'on' : ''}" data-st="${st.id}"><div><div class="t">${esc(st.name)}</div><div class="s">${esc(st.area)}</div></div></button>`).join('')}
          <label class="fld">Pump number</label>
          <select class="txt" id="pump">${Array.from({ length: STATIONS.find((x) => x.id === draft.station).pumps }, (_, i) => `<option value="${i + 1}" ${draft.pump === i + 1 ? 'selected' : ''}>Pump ${i + 1}</option>`).join('')}</select>
        </div>
        <div class="card"><h3>2 · Fuel</h3>
          <div class="chips">${FUELS.map((f) => `<button class="chip ${draft.fuel === f.id ? 'on' : ''}" data-fuel="${f.id}">${f.name} · RM ${(f.price / 100).toFixed(2)}/L</button>`).join('')}</div>
        </div>
        <div class="card"><h3>3 · Amount to reserve</h3>
          <div class="chips">${HOLD_CHOICES.map((a) => `<button class="chip ${draft.hold === a ? 'on' : ''}" data-hold="${a}">${rm(a)}</button>`).join('')}</div>
          <div class="muted" style="margin-top:10px">≈ ${(draft.hold / price).toFixed(1)} L of ${FUELS.find((f) => f.id === draft.fuel).name}. Card payments reserve this amount first; the final charge is the fuel you pump.</div>
        </div>
        <button class="btn red" id="next">Continue</button>`;
    },
    after() {
      $$('[data-st]').forEach((b) => (b.onclick = () => { draft.station = b.dataset.st; draft.pump = 1; paint(); }));
      $$('[data-fuel]').forEach((b) => (b.onclick = () => { draft.fuel = b.dataset.fuel; paint(); }));
      $$('[data-hold]').forEach((b) => (b.onclick = () => { draft.hold = Number(b.dataset.hold); paint(); }));
      $('#pump').onchange = (e) => (draft.pump = Number(e.target.value));
      $('#next').onclick = () => go('pumpPay');
    },
  };

  screens.pumpPay = {
    title: 'Payment', tab: 'pump', back: 'pump',
    html() {
      const st = STATIONS.find((x) => x.id === draft.station);
      const f = FUELS.find((x) => x.id === draft.fuel);
      const s = D.get();
      const short = s.wallet < draft.hold;
      return `
        <div class="card"><div class="row"><div><div class="t" style="font-weight:700">${esc(st.name)} · Pump ${draft.pump}</div><div class="muted">${f.name}</div></div><div style="font-weight:750;font-size:18px">${rm(draft.hold)}</div></div></div>
        <div class="card"><h3>Pay with card · pre-authorisation</h3>
          <div class="muted">We reserve ${rm(draft.hold)} now and charge only the fuel you pump. Pick a saved card or add a new one.</div>
          <div class="pay-box" id="dropin"></div>
          <div class="hint">Test card: 4111 1111 1111 1111 · 03/30 · CVC 737</div>
        </div>
        <div class="card"><h3>Or pay with wallet</h3>
          <div class="muted">Wallet balance ${rm(s.wallet)}. Wallet payments are prepaid for the full amount (no pre-authorisation).</div>
          <div style="margin-top:12px">${short
            ? `<button class="btn ghost" id="topupShort">Top up ${rm(Math.max(draft.hold - s.wallet, 1000))} to pay with wallet</button>`
            : `<button class="btn" id="walletPay">Pay ${rm(draft.hold)} from wallet</button>`}</div>
        </div>`;
    },
    after() {
      mountDropin($('#dropin'), { kind: 'preauth', amount: draft.hold, meta: { station: draft.station, pump: draft.pump, fuel: draft.fuel } });
      const ws = $('#walletPay');
      if (ws) ws.onclick = () => {
        D.update((s) => {
          s.wallet -= draft.hold;
          const st = STATIONS.find((x) => x.id === draft.station);
          s.txns.unshift({ id: D.uid(), type: 'wallet-fuel', title: `${st.name} · Pump ${draft.pump}`, amount: -draft.hold, status: 'success', ts: Date.now() });
        });
        go('result', { icon: '✅', title: 'Paid from wallet', text: `${rm(draft.hold)} paid. Pump ${draft.pump} is ready.`, cta: ['Back to home', 'home'] });
      };
      const ts = $('#topupShort');
      if (ts) ts.onclick = () => { draft.topup = Math.max(Math.ceil((draft.hold - D.get().wallet) / 1000) * 1000, 1000); go('topup'); };
    },
  };

  screens.topup = {
    title: 'Top up wallet', tab: 'topup',
    html(p) {
      const stage = p.pay ? 'pay' : 'amount';
      if (stage === 'pay') {
        return `
          <div class="card"><div class="row"><div class="muted">Top-up amount</div><div style="font-weight:750;font-size:20px">${rm(draft.topup)}</div></div>
            <button class="btn ghost small" id="change" style="margin-top:10px">Change amount</button></div>
          <div class="card"><h3>Choose how to pay</h3><div class="pay-box" id="dropin"></div>
          <div class="hint">Pay with a card, DuitNow QR, FPX online banking or an e-wallet. Test card: 4111 1111 1111 1111 · 03/30 · CVC 737</div></div>`;
      }
      return `
        <div class="card"><h3>How much would you like to add?</h3>
          <div class="chips">${TOPUP_CHOICES.map((a) => `<button class="chip ${draft.topup === a ? 'on' : ''}" data-amt="${a}">${rm(a)}</button>`).join('')}</div>
          <label class="fld">Or enter an amount (RM)</label>
          <input class="txt" id="custom" inputmode="decimal" placeholder="e.g. 75" value="${TOPUP_CHOICES.includes(draft.topup) ? '' : (draft.topup / 100).toFixed(2)}" />
        </div>
        <button class="btn red" id="goPay">Continue to payment</button>`;
    },
    after(p) {
      if (p.pay) {
        $('#change').onclick = () => go('topup');
        return mountDropin($('#dropin'), { kind: 'topup', amount: draft.topup, meta: {} });
      }
      $$('[data-amt]').forEach((b) => (b.onclick = () => { draft.topup = Number(b.dataset.amt); paint(); }));
      $('#custom').oninput = (e) => {
        const v = Math.round(parseFloat(e.target.value) * 100);
        if (Number.isFinite(v)) { draft.topup = v; $$('[data-amt]').forEach((b) => b.classList.remove('on')); }
      };
      $('#goPay').onclick = () => {
        if (!(draft.topup >= 100 && draft.topup <= 100000)) return toast('Enter an amount between RM 1 and RM 1,000');
        go('topup', { pay: true });
      };
    },
  };

  screens.cards = {
    title: 'My cards', tab: 'cards',
    html: () => `<div id="cardlist"><div class="spinner"></div></div>
      <button class="btn red" id="add" style="margin-top:6px">Add a card</button>
      <button class="btn ghost" id="refresh" style="margin-top:10px">Refresh list</button>
      <div id="diag"></div>`,
    async after() {
      $('#add').onclick = () => go('addCard');
      $('#refresh').onclick = () => paint();
      const lastAttempt = () => {
        try { return JSON.parse(localStorage.getItem('petron_last_addcard') || 'null'); } catch { return null; }
      };
      const pendingNote = () => {
        const l = lastAttempt();
        return l && l.resultCode === 'Authorised'
          ? `<div class="hint">Adyen approved the card check${l.pspReference ? ' (psp ' + esc(l.pspReference) + ')' : ''} but returned no saved card for this shopper reference. See Troubleshooting below.</div>`
          : '';
      };
      const renderDiag = (count, dbg) => {
        let last = null;
        try { last = JSON.parse(localStorage.getItem('petron_last_addcard') || 'null'); } catch { /* ignore */ }
        const lastTxt = last
          ? [new Date(last.ts).toLocaleTimeString('en-MY'), last.stage, last.resultCode, last.error, last.refusalReason, last.action && 'action: ' + last.action, last.pspReference && 'psp ' + last.pspReference].filter(Boolean).join(' · ')
          : 'none yet on this browser';
        $('#diag').innerHTML = `<div class="card" style="margin-top:14px"><h3>Troubleshooting</h3>
          <dl class="kv"><dt>Shopper reference</dt><dd>${esc(D.get().shopperRef)}</dd>
          <dt>Cards found at Adyen</dt><dd>${count === null ? 'could not load' : count + (dbg ? ` (Adyen returned ${dbg.adyenCount}${dbg.types?.length ? ': ' + esc(dbg.types.join(', ')) : ''})` : '')}</dd>
          <dt>Last add-card attempt</dt><dd>${esc(lastTxt)}</dd></dl>
          <div class="muted">Search the shopper reference or psp reference in Adyen Customer Area → Transactions → Payments.</div></div>`;
      };
      renderDiag(null);
      const box = $('#cardlist');
      try {
        const cfg = await D.config();
        if (!cfg.ready) throw new Error('Adyen is not configured yet. Missing: ' + cfg.missing.join(', '));
        const { cards, debug } = await D.api('/api/stored-cards?shopperReference=' + encodeURIComponent(D.get().shopperRef));
        renderDiag(cards.length, debug);
        box.innerHTML = cards.length
          ? `<div class="card"><h3>Saved cards</h3>${cards.map((c) => `<div class="list-item"><div><div class="t">💳 ${esc(c.brand)} •••• ${esc(c.lastFour || '')}</div><div class="muted">${esc(c.holderName || '')} · expires ${esc(c.expiryMonth)}/${esc(c.expiryYear)}</div></div></div>`).join('')}<div class="muted" style="margin-top:8px">Tokens are stored by Adyen. Your app never sees the card number.</div></div>`
          : '<div class="card center"><div class="big-ic">💳</div><div class="t" style="font-weight:700">No saved cards yet</div><div class="muted">Add a card to pay at the pump with a pre-authorisation.</div>' + pendingNote() + '</div>';
      } catch (e) {
        box.innerHTML = banner(e.message, true);
      }
    },
  };

  screens.addCard = {
    title: 'Add a card', tab: 'cards', back: 'cards',
    html: () => `
      <div class="card"><h3>Card details</h3><div id="card"></div>
        <button class="btn red" id="save" style="margin-top:14px" disabled>Save card</button>
        <div class="hint">Test card: 4111 1111 1111 1111 · 03/30 · CVC 737. Saving runs a zero-value authorisation (no charge) and stores a token with Adyen.</div>
      </div>`,
    async after() {
      const el = $('#card');
      el.innerHTML = '<div class="spinner"></div>';
      try {
        const { checkout } = await buildCheckout({ kind: 'addcard', amount: 0, meta: {} });
        el.innerHTML = '';
        const { Card } = window.AdyenWeb;
        const card = new Card(checkout, {
          hasHolderName: true, holderNameRequired: true, billingAddressRequired: false, showPayButton: false,
          onChange: (state) => { $('#save').disabled = !state.isValid; },
        });
        card.mount(el);
        activeComponent = card;
        $('#save').onclick = () => { $('#save').disabled = true; card.submit(); };
      } catch (e) {
        el.innerHTML = banner(e.message, true);
      }
    },
  };

  screens.activity = {
    title: 'Activity', tab: 'activity',
    html() {
      const s = D.get();
      const txnRow = (t) => `<div class="list-item"><div><div class="t">${esc(t.title)}</div><div class="muted">${esc(new Date(t.ts).toLocaleString('en-MY'))}</div></div>
        <div style="text-align:right"><div class="${t.amount > 0 ? 'amt-plus' : 't'}">${t.amount > 0 ? '+' : ''}${rm(Math.abs(t.amount))}</div>${t.status === 'pending' ? '<span class="pill warn">Pending</span>' : ''}</div></div>`;
      return `
        <div class="card"><h3>Fuel holds & charges</h3>${s.holds.length ? s.holds.map(holdRow).join('') : '<div class="muted">No fuel payments yet.</div>'}</div>
        <div class="card"><h3>Wallet</h3>${s.txns.length ? s.txns.map(txnRow).join('') : '<div class="muted">No wallet activity yet.</div>'}</div>
        <button class="btn ghost" id="pos">Open Station POS (merchant view)</button>
        <button class="btn ghost" id="reset" style="margin-top:10px">Reset demo data</button>`;
    },
    after() {
      $('#pos').onclick = () => window.open('/pos.html', '_blank');
      $('#reset').onclick = () => { if (confirm('Reset wallet, holds and activity? (Saved card tokens belong to the old shopper and will no longer show.)')) { D.reset(); go('home'); } };
    },
  };

  screens.result = {
    title: 'Petron Pay',
    html: (p) => `<div class="center"><div class="big-ic">${p.icon}</div><h2 style="margin:0 0 8px">${esc(p.title)}</h2><div class="muted" style="margin-bottom:22px">${esc(p.text)}</div>
      <button class="btn" data-go="${p.cta[1]}">${esc(p.cta[0])}</button>
      ${p.link ? `<a class="btn ghost" style="display:block;margin-top:10px;text-decoration:none;text-align:center" href="${p.link[1]}" target="_blank">${esc(p.link[0])}</a>` : ''}</div>`,
  };
  screens.processing = { title: 'Petron Pay', html: () => '<div class="center"><div class="spinner"></div><div class="muted">Confirming your payment…</div></div>' };

  // ---- boot --------------------------------------------------------------------------------------------
  // If the shopper just came back from a bank / e-wallet page, finish the payment first.
  async function handleReturn() {
    const rr = new URLSearchParams(location.search).get('redirectResult');
    if (!rr) return false;
    history.replaceState({}, '', location.pathname);
    let pending = null;
    try { pending = JSON.parse(localStorage.getItem('petron_pending') || 'null'); } catch { /* ignore */ }
    if (!pending) { toast('Returned from payment, but no pending order was found.'); return false; }
    go('processing');
    try {
      const { checkout } = await buildCheckout(pending);
      checkout.submitDetails({ details: { redirectResult: rr } });
    } catch (e) {
      go('result', { icon: '❌', title: 'Could not confirm payment', text: e.message, cta: ['Back to home', 'home'] });
    }
    return true;
  }

  // Optional logo: drop an official logo file into /public/img/ named petron-logo.svg or petron-logo.png.
  (function loadLogo(i = 0) {
    const files = ['/img/petron-logo.svg', '/img/petron-logo.png'];
    if (i >= files.length) return;
    const img = $('#logo');
    img.onload = () => (img.hidden = false);
    img.onerror = () => loadLogo(i + 1);
    img.src = files[i];
  })();

  $$('#tabs button').forEach((b) => (b.onclick = () => go(b.dataset.tab)));
  window.addEventListener('storage', () => { if (['home', 'activity'].includes(view.name)) paint(); });
  window.addEventListener('focus', () => { if (['home', 'activity'].includes(view.name)) paint(); });

  (async () => {
    paint();
    D.config().then((cfg) => {
      if (!cfg.ready && view.name === 'home') {
        $('#screen').insertAdjacentHTML('afterbegin', banner('Adyen is not configured yet. Set ' + cfg.missing.join(', ') + ' in Cloudflare Pages → Settings → Variables and secrets, then redeploy.', true));
      }
    }).catch(() => {});
    await handleReturn();
  })();
})();
