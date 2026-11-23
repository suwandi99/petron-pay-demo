# Petron Pay – Adyen Checkout demo

A mobile-app-style web demo for Petron Malaysia, built on **Adyen Web v6 (Drop-in + Card Component)** with a small
server layer in **Cloudflare Pages Functions** (so your Adyen API key never reaches the browser).

| Screen | What it shows | Adyen pieces |
| --- | --- | --- |
| **Pay at pump** | Pick station, pump, fuel, amount. Pay by card with a **pre-authorisation** (hold). Or pay from wallet. | Drop-in (cards + saved cards), `/payments` with `authorisationType=PreAuth`, manual capture |
| **Top up** | Add wallet balance with a **non-card** method. | Drop-in filtered to DuitNow QR / FPX / Touch 'n Go / GrabPay / Boost |
| **Cards → Add a card** | Dedicated add-card screen. Zero-value authorisation stores a token. | Card Component, `storePaymentMethod`, `/storedPaymentMethods` |
| **Station POS** (`/pos.html`) | Merchant view: full capture, **partial capture**, **over-capture**, adjust, release. Shows each API call. | `/captures`, `/amountUpdates`, `/cancels` |

State (wallet, holds, activity) is kept in the browser's localStorage, so open the app and the POS in the **same browser** (two windows side by side works well).

---

## 1. Put the code on GitHub (no command line needed)

1. Unzip the download. You will see a folder called `petron-pay-demo` containing `public`, `functions`, `README.md`.
2. Go to <https://github.com> and sign in (or create a free account).
3. Click the **+** at the top right → **New repository**.
   - Repository name: `petron-pay-demo`
   - Choose **Private** (recommended) → click **Create repository**. Leave "Add a README" unticked.
4. On the next page click the link **"uploading an existing file"**.
5. Open the unzipped `petron-pay-demo` folder, select **everything inside it** (the `public` folder, the `functions` folder and the other files) and drag it onto the GitHub page. Do not drag the outer folder itself.
6. Wait for the upload to finish, then click **Commit changes**.
7. Check the repo's front page: you should see `public/` and `functions/` at the top level.

To change the demo later: open a file on GitHub → pencil icon → edit → **Commit changes**. Cloudflare redeploys automatically.

## 2. Deploy on Cloudflare Pages (gives you `https://<name>.pages.dev`)

1. Go to <https://dash.cloudflare.com> → **Workers & Pages** → **Create** → **Pages** → **Connect to Git**.
2. Authorise GitHub if asked, pick the `petron-pay-demo` repository, click **Begin setup**.
3. Settings:
   - **Project name**: this becomes your URL, e.g. `petron-pay-demo` → `https://petron-pay-demo.pages.dev`
   - **Production branch**: `main`
   - **Framework preset**: None
   - **Build command**: leave empty
   - **Build output directory**: `public`
4. Click **Save and Deploy**. The first deploy will load, but payments will say "Adyen is not configured yet" until step 3 below.

(The `functions/` folder is picked up automatically and becomes the `/api/...` endpoints.)

## 3. Add your Adyen settings

In Cloudflare: your Pages project → **Settings** → **Variables and secrets** (shown as *Environment variables* in some versions) → add these for **Production** (and Preview if you use it):

| Name | Type | Value |
| --- | --- | --- |
| `ADYEN_API_KEY` | Secret | Your **test** API key |
| `ADYEN_CLIENT_KEY` | Text | Your **test** client key (`test_...`) |
| `ADYEN_MERCHANT_ACCOUNT` | Text | Your merchant account name |
| `POS_PIN` | Secret (optional) | A short PIN required for capture/adjust/release, so strangers with the URL can't touch your payments |
| `TOPUP_METHODS` | Text (optional) | Default: `duitnow,molpay_ebanking_fpx_MY,touchngo,grabpay_MY,molpay_boost` |
| `CHECKOUT_API_VERSION` | Text (optional) | Default `72` (Adyen Web v6 needs Checkout API v72 or later) |

Then go to **Deployments** → latest deployment → **⋯** → **Retry deployment** (variables only apply to new deployments).

## 4. Adyen Customer Area checklist (test account)

- **API credential** with Checkout API permissions. Under **Allowed origins** add `https://<your-project>.pages.dev` (required for the client key to work in the browser).
- **Payment methods** (Settings → Payment methods): cards, **FPX**, **Touch 'n Go / GrabPay / Boost** are on your account already. **DuitNow QR is not** – ask your Adyen contact / Support to enable it; once enabled it appears in Top up automatically (type `duitnow`).
- **Multiple partial captures** are disabled by default and need Adyen Support to switch on. A single partial capture works out of the box.
- **Over-capture**: Adyen's public docs describe capturing up to the authorised amount. The demo does it the documented way for fuel: *adjust the pre-authorisation upwards (`/amountUpdates`), then capture the new total*. If you want true scheme over-capture, confirm availability for your merchant account and card schemes with Adyen first.
- This demo does **not** receive webhooks. Capture/adjust calls return "received"; the real outcome arrives as CAPTURE / AUTHORISATION_ADJUSTMENT webhooks. A production build must handle those.

Test card: `4111 1111 1111 1111`, expiry `03/30`, CVC `737`.

## 5. Suggested demo script

1. **Top up**: wallet shows RM 15. Tap *Pay at pump → RM 100*, the wallet can't cover it → *Top up* → pay with FPX / e-wallet (or DuitNow QR once enabled). Wallet updates.
2. **Add card**: *Cards → Add a card* → save the test card (zero-value auth, token stored).
3. **Pay at pump with card**: choose the saved card → RM 100 **pre-authorisation**. Show the hold in *Activity*.
4. **Station POS** (`/pos.html`): the customer pumped RM 62 → **partial capture**. Repeat with another hold: pumped RM 120 → **over-capture** (adjust + capture). Release a third hold: pump not used.

## Local preview (optional)

```bash
cp .dev.vars.example .dev.vars   # fill in your test credentials
npx wrangler pages dev public
```

## Project layout

```
public/            static app (index.html = customer app, pos.html = Station POS)
functions/api/     Pages Functions (server side, holds the API key)
functions/_lib/    shared server helpers
```
