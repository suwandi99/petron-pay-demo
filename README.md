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

## 5. Add the Petron logo

Save the official logo file (from Petron's brand assets) as `public/img/petron-logo.svg` or `public/img/petron-logo.png`. On GitHub: open `public` → `img` → **Add file** → **Upload files** → **Commit changes**. It appears in the app's top bar after the automatic redeploy (about a minute). Without a file the app just shows the plain "Petron Pay" title.

## 6. How to operate the demo

**Before the session**
- Open `https://<project>.pages.dev` on your phone (or in a desktop browser) and `https://<project>.pages.dev/pos.html` in a second browser window. For both to share the same wallet and holds they must be in the **same browser on the same device**. Easiest: one laptop, two windows side by side.
- Activity tab → **Reset demo data** gives you a clean start (wallet back to RM 15, no holds, new shopper).
- If you set `POS_PIN`, the POS asks for it the first time you press a button.

**Run of show (about 8 minutes)**
1. **Top up (non-card).** Home shows a RM 15 wallet. Tap *Pay at pump*, keep RM 100, *Continue*. The wallet is too low, so tap the *Top up* button → choose an amount → *Continue to payment* → pay with FPX or an e-wallet (DuitNow QR once enabled). The wallet balance updates.
2. **Add a card.** *Cards* tab → *Add a card* → test card `4111 1111 1111 1111`, `03/30`, `737`, any name → *Save card*. It runs a zero-value authorisation and stores a token with Adyen.
3. **Pay at pump with a card (pre-authorisation).** *Pump* tab → station, pump, fuel, RM 100 → *Continue* → the saved card appears in the Drop-in (enter CVC 737) → pay. The app says the pump is ready and shows a RM 100 **hold**.
4. **Station POS** (merchant view). Open `/pos.html`, select the hold, then:
   - **Partial capture:** leave the default (about 62%) or type the final amount, e.g. RM 62 → *Partial capture*. The unused RM 38 is released.
   - **Over-capture:** repeat steps 3–4 with a new hold, type RM 120 → the button reads *Over-capture* (adjusts the hold up by RM 20, then captures).
   - **Release:** a third hold → *Release hold (pump not used)*.
   Switch back to the app's Activity tab: the hold shows as *Charged* or *Hold released*.
5. Point out the **Adyen API calls** panel on the POS: `/payments` (PreAuth), `/amountUpdates`, `/captures`, `/cancels`.

**If something goes wrong**
- *"Adyen is not configured yet"*: a variable from step 3 is missing, or you didn't retry the deployment after adding it.
- *Card form doesn't load / blank Drop-in*: the `pages.dev` URL isn't in the API credential's **Allowed origins**, or the client key is wrong.
- *Top up shows no methods*: none of the non-card methods are enabled on the merchant account yet (or `TOPUP_METHODS` excludes them).
- *Capture error from Adyen*: the POS shows Adyen's message in the API calls panel. Typical causes: the payment isn't a manual-capture pre-authorisation, the amount exceeds what is allowed, or a second partial capture (needs Adyen Support to enable).
- *Saved card doesn't appear straight away*: wait a few seconds and reopen the Cards tab.
- The wallet and holds live only in that browser. Clearing site data or using another browser starts fresh.

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
