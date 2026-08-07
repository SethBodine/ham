# ZL Ham Radio Toolkit

Two tools, one Cloudflare Pages site, deployed to **https://ham.b0x.co.nz**:

- **`/study`** — a study/self-test tool for the NZART Amateur Radio Examination
  (New Zealand only). All 600 questions from the NZART question bank, with
  three modes: **Learn** (speed-learning flashcards, answer auto-reveals),
  **Test** (answer yourself, immediate right/wrong + explanation), and
  **Mock Exam** (60 questions drawn the same way the real exam is built —
  one per ten questions per topic — pass mark 40/60).
- **`/calllog`** — a private, key-protected station contact log backed by
  Cloudflare KV, with flexible fields (missing data is just "not filled in
  yet", not an error).

Both are static HTML/CSS/vanilla JS plus a handful of Cloudflare Pages
Functions for the call log's API. No build step, no framework, no bundler.

## Repo layout

```
/                    landing page
/study                exam study tool (static)
  data/questions.json  600 parsed questions (public domain per NZART)
/calllog              call log frontend (static)
/functions/api         Pages Functions (the call log's backend)
  entries/index.js       GET (list) / POST (create)
  entries/[id].js         PUT (update) / DELETE
  settings.js             station callsign setting
  verify.js               cheap "is this key valid" check for the login screen
/functions/_auth.js    shared auth + KV-namespacing helper
wrangler.toml         KV binding config
_headers              security headers (see below)
robots.txt            keeps /calllog out of search indexes
```

## Deploying

1. Push this repo to GitHub.
2. In Cloudflare Pages, create a project from the GitHub repo.
   - Build command: none / leave blank.
   - Build output directory: `/` (the repo root).
3. Add the custom domain `ham.b0x.co.nz` to the Pages project.
4. Create the KV namespace and bind it:
   ```
   npx wrangler kv namespace create LOGBOOK
   ```
   Copy the returned `id` into `wrangler.toml`, **or** bind it in the Pages
   dashboard under Settings → Functions → KV namespace bindings (binding
   name must be `LOGBOOK`) — either approach works; the dashboard binding
   takes precedence in the Pages UI-managed flow.
5. Generate the call log access key and store it as a Pages **secret**
   (not in the repo):
   ```
   openssl rand -hex 32
   npx wrangler pages secret put LOG_API_KEY
   ```
   or add it via the dashboard: Pages project → Settings → Environment
   variables → add `LOG_API_KEY` as **encrypted**.
6. Deploy. Visit `https://ham.b0x.co.nz/calllog` and enter the key you
   generated to unlock it.

## The exam study tool

- `study/data/questions.json` holds the full 600-question NZART bank,
  extracted from the NZART question-bank PDF, which states the questions
  are in the public domain. Each question also carries an `explanation`
  field (the "why" behind the correct answer) and, for the ~70 questions
  that reference a figure in the original PDF (block diagrams, transistor
  pinouts, antenna diagrams), a `diagram` field naming one of the 16
  reusable diagrams in `study/data/diagrams.json`.
- `study/data/diagrams.json` holds those 16 diagrams as inline SVG strings,
  generated programmatically (see the layout logic, not committed, used to
  build them) so their box/arrow coordinates are guaranteed consistent.
  They're schematic reconstructions of NZART's figures (matching block
  names, signal flow, and answer-key-consistent pin labelling) rather than
  pixel copies of the original artwork.
- Each question has an `id` like `"27-14"` (topic 27, question 14 in that
  topic), the four options, and the correct answer letter. There are no
  official worked explanations in the source PDF — "Test" mode shows the
  correct option and its text rather than a fabricated explanation.
- Progress (per-question seen/correct counts) is stored only in
  `localStorage` in the visitor's own browser — nothing is sent anywhere.
- To refresh the question bank later (e.g. if NZART revises it), replace
  `study/data/questions.json` with a new array of objects shaped like:
  ```json
  { "id": "1-1", "topic": 1, "topicName": "Regulations",
    "question": "...", "options": {"a":"...","b":"...","c":"...","d":"..."},
    "answer": "c" }
  ```

## The call log tool — how the security model works

- **Single shared access key**, generated with `openssl rand -hex 32` and
  stored only as a Cloudflare secret (`LOG_API_KEY`). It's never in the repo.
- The frontend sends the key as `Authorization: Bearer <key>` on every API
  call. `functions/_auth.js` checks it using a digest comparison (not a
  naive string compare) and fails closed if the secret isn't configured.
- **Ready for multiple operators later:** the key is hashed (SHA-256) and
  the first 16 hex characters become an "operator" namespace prefix for
  every KV key (`entry:<operatorId>:<uuid>`). Today there's one key, so
  there's one namespace — but adding a second key later (e.g. a per-person
  `LOG_API_KEY_2`) would just start writing to a second namespace with **no
  data migration needed**.
- **Custom fields have a real schema, not just per-entry JSON.** Each custom
  field is defined once — name, type (`text` / `number` / `date`), and for
  text fields, a character cap — and stored in KV at `fields:<operatorId>`
  via `functions/api/fields.js` (`GET`/`POST`) and
  `functions/api/fields/[key].js` (`DELETE`). Defining a field makes it show
  up as its own input on every future Add/Edit form automatically; the
  `entries` endpoints look up this registry on every write and enforce each
  field's own character cap server-side (not just via the HTML `maxlength`
  attribute, which isn't a real boundary).
- **Deleting a field is non-destructive to existing data.** `DELETE
  /api/fields/<key>` only removes the *definition* — it does not touch any
  entry. A contact that already has a value in that field keeps it (shown
  in the table with a "†" marker) until that specific contact is next
  edited and saved, at which point the field is dropped from it (the
  frontend sends that key as `null`, which the `PUT` handler treats as "delete
  this key from the stored entry" rather than storing a `null` value).
- **Flexible fields:** entries always keep `id`, `createdAt`, `updatedAt`,
  plus whatever fields you send (`callsign`, `date`, `time`, `frequency`,
  `mode`, `sigRcvd`, `sigSent`, `notes`, or any registered custom field).
  Anything you haven't filled in for a given contact just doesn't exist on
  that record — the table shows "—" for it rather than treating it as an
  error.
- **No TTL** — `env.LOGBOOK.put()` is called without an `expirationTtl`,
  so entries persist until you explicitly delete them.

### OWASP Top 10 considerations addressed

- **A01 Broken Access Control** — every write/read to the log goes through
  server-side key verification in the Pages Function; there's no
  client-side-only gate.
- **A02 Cryptographic Failures** — the key is a 256-bit random value
  generated with `openssl rand`, stored only as an encrypted platform
  secret, and compared via a SHA-256 digest rather than a raw string
  comparison. All traffic is HTTPS by default on Cloudflare Pages, and
  HSTS is set via `_headers`.
- **A03 Injection** — no SQL/templating is involved; all API input is
  parsed as JSON, field names/values are length-capped and stripped of
  control characters, and the UI renders values as text (never HTML), so
  there's no injection or stored-XSS path.
- **A04/A05 Insecure Design / Security Misconfiguration** — the server
  fails **closed** if the secret isn't configured (returns 401, not a
  default-allow); `_headers` sets CSP, `X-Frame-Options`, `X-Content-Type-
  Options`, `Referrer-Policy`, and a restrictive `Permissions-Policy`;
  `/calllog` is excluded from indexing via `robots.txt` and `X-Robots-Tag`.
- **A07 Identification & Authentication Failures** — a single high-entropy
  bearer token stands in for a login system appropriate to a single-user
  private tool; there's no password to brute-force, guess, or reuse.
  Because auth is a header (not a cookie), the API is not subject to CSRF.
- **A08 Software & Data Integrity** — no third-party scripts are loaded by
  either app (checked by the CSP's `script-src 'self'`), so there's no
  supply-chain script-injection surface.

### Known trade-offs (worth knowing about)

- There's no per-request rate limiting in the code here — Cloudflare's
  dashboard lets you add a rate-limiting rule for `/api/*` on this zone if
  you want extra protection against key-guessing; with a 256-bit key this
  is a defence-in-depth measure rather than a necessity.
- The key is stored in the browser's `localStorage` after first entry, for
  convenience — anyone with access to that browser profile can read it.
  Don't use this on a shared/public computer, and treat the key like a
  password.

## Local development

```
npx wrangler pages dev . --kv LOGBOOK
```

This serves the static files and runs the Functions locally against a
local KV emulation.
