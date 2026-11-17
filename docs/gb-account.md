# GameBanana account sign-in

Researched 13 Nov 2026. Everything here was read from public pages, GameBanana's own site scripts and other people's
code. Nothing was signed in to, so anything that only shows up after a login is marked as unverified.

## Verdict

**Works without emailing anyone: yes.** There is no API key, app registration or approval step for acting as a
signed-in member. GameBanana's own website calls its JSON API with nothing but the session cookie, and other mod
managers already copy that. The app opens GameBanana's real login page in its own window, the user signs in there, and
the app keeps the resulting cookies and sends them with its API calls.

Caveats, in order of weight:

1. The endpoints are undocumented. They are what the site's own scripts call today and can change without notice.
2. Nobody on our side has run the full flow in WebView2 (cookie names, session lifetime and the captcha step are
   unverified). Build it behind `available: false` and test with a real account before showing it.
3. The cookie is the whole account. Treat it like a password.

## Why no key or email

- GameBanana has "Apps" (`gamebanana.com/apps/add`, any member can add one with a form, no email). These are small
  programs that run on the site, not API credentials for desktop tools.
- The old API at `api.gamebanana.com` uses an App ID, an API password and a user id (`Core/App/Authenticate`). Its
  endpoints are read-only lists and item data. There is no subscribe, like or comment. The sample repos date from 2017.
- `apiv11` and `apiv13` have no key at all. Reads need nothing (the app already does this). Writes need a session.
- Nexus-style app registration does not exist here, so there is nothing to email.

## The flow

1. User clicks "Sign in to GameBanana" (Settings > Account, links and AI > GameBanana account, or any subscribe/follow button while signed out).
2. A command opens a separate window, label `gb-login`, pointing at `https://gamebanana.com/members/account/login`.
   Not an iframe: that page sends `x-frame-options: DENY`. A top-level window is fine.
3. The user signs in on GameBanana's page. Username and password, or the email-code tab. If GameBanana asks for a
   captcha (Cloudflare Turnstile) or a 6-digit authenticator code, its page handles that itself. The app never sees the
   password and never types anything into the page.
4. When the window finishes loading any gamebanana.com page (and when it is closed), the page itself is asked: a
   script run with `eval_with_callback` makes a synchronous `GET /apiv13/Member/UiConfig` and returns `_bIsLoggedIn`,
   `_idMemberRow`, the name, `_sAvatarUrl` and `navigator.userAgent`. Asking from inside the page uses that window's
   own cookies and browser, so Cloudflare and a session tied to the browser both see the same client that signed in.
   The login script itself redirects away after success (to the previous page or the home page).
5. Once the page says someone is signed in, the app reads the window's gamebanana.com cookies (on another thread, with
   a 10 second limit, since the read runs on the main thread), keeps the member from the page (the API fills in the
   name and picture when it answers), stores the cookie header encrypted and the browser's User-Agent in settings, and
   closes the window. Closing the window by hand checks once more and always closes; a toast says you are not signed
   in (with the reason, if there is one) and offers to try again. Every failed step is in the log as
   "GameBanana sign-in: ...".
6. Later calls go from Rust with `Cookie: <stored header>` and the sign-in window's User-Agent. Sign out deletes the stored header and the login window's
   data folder. The server session stays valid until it expires (the site's logout call was not found, so don't invent
   one).

### Tauri 2 details

- `Webview::cookies_for_url(url)` and `cookies()` exist from Tauri 2.4 (the repo has 2.12.5). On Windows they use
  WebView2's cookie manager and return HttpOnly and Secure cookies too. `set_cookie` and `delete_cookie` came in 2.8.
- Known issue from the Tauri source: on Windows these deadlock inside a sync command or event handler. Make the
  commands `async` and read cookies from a spawned thread, not the page-load callback itself.
- Build the header from every cookie for the site: `name=value; name=value`. The cookie names are unconfirmed (they only
  appear after login), and Cloudflare cookies may matter, so don't filter by name.
- Give the window its own `data_directory` (for example under `%APPDATA%`) so the site's cookies stay out of the app's
  main webview. Don't use `incognito` there: WebView2 wants matching options for one data folder (unverified, test it).
- Keep the `gb-login` label out of `src-tauri/capabilities/*`. The default capability is bound to `windows: ["main"]`,
  so the page gets no Tauri commands. Don't add it to any `remote.urls`.
- Don't inject scripts into the login page and don't add a strict `on_navigation` allowlist. The Turnstile widget loads
  from `challenges.cloudflare.com` and a filter could break it (unverified).
- Store the header with Windows DPAPI (`CryptProtectData`) in a file under `%APPDATA%`. The Credential Manager blob
  limit is about 2.5 KB and Cloudflare cookies can eat most of that.
- Don't call GameBanana from the React side. CORS answers `access-control-allow-origin: *` without credentials, so a
  `fetch` from the app's page would go out without the cookie. Rust only.

### Evidence that this works

- deltamod (an Electron mod manager) opens the same login URL in a window, reads all gamebanana.com cookies when the
  page leaves `/members/account`, stores them, then calls `apiv13` with just `Cookie` and a
  browser User-Agent. It uses `Member/UiConfig`, `{Model}/{id}/Like`, `{Model}/{id}/Post/Add`, `Collection/Add` and
  `{Model}/{id}/AddToCollection` that way.
- Tessera and pybanana post the username and password to `apiv11/Member/Authenticate` and keep the `Set-Cookie`
  values. Tessera then checks `GET /apiv11/Member/Session`. We should not copy this route (see "Never").
- The site's own axios client (`baseURL: /apiv13`) sets no CSRF header or token. A guest write is answered with
  `401 LOGIN_REQUIRED`, not a token error.

## Endpoints

Base is `https://gamebanana.com/apiv13`. The site's scripts use `apiv13` today. `apiv11` still answers the same paths
we use for reads. Send `Cookie`, `Accept: application/json` and, on bodies, `Content-Type: application/json`. Errors
look like `{ "_sErrorCode": "...", "_sErrorMessage": "...", "_aErrorData": {...} }`. Success bodies carry
`_sSuccessMessage`. `{Model}` is the record's `_sModelName` (`Mod`, `Member`, `Game`, `Tool`, `Studio`...).

Seen myself (public requests, or read from the site's scripts):

| Call | What it does |
| --- | --- |
| `GET /apiv11/Member/Session` | Guest answer is `{ "_bIsLoggedIn": false }`. Signed in adds `_idMemberRow` (from Tessera's code, not seen live). |
| `GET /Member/UiConfig?_sUrl=/` | Guest has `_bIsLoggedIn: false`. Signed in adds `_idMemberRow`, `_aSubscribedGames`, `_aPointDetails._nPoints`, `_bHasFreeThank`. Also holds `_aContentRatingBehaviors`, the member's content settings (`show`, `warn` or `hide` per rating code). Guests get GameBanana's defaults there, so it answers for everyone; only `_bIsLoggedIn: true` makes it the member's own. |
| `GET /Member/{id}/ProfilePage` | `_sName`, `_sAvatarUrl`, `_sHdAvatarUrl`. With a session, the page also reads `_bAccessorIsSubscribed`, `_idAccessorSubscriptionRow`, `_bAccessorIsBuddy` from it. |
| `GET /Mod/{id}/ProfilePage` | With a session adds `_bAccessorHasLiked`, `_bAccessorHasThanked` (named in the site's scripts, absent for guests). |
| `GET /Member/{id}/Subscriptions?_nPage=1&_sModelName=Content` | `_sModelName` is `Content`, `Member`, `Studio` or `Game`. 15 per page. Records are `{ _idRow, _aSubscription: { _idRow, _sModelName, _sName, _sProfileUrl, _aSubmitter, _aGame, ... } }`. Public: it answered with no cookie. Record `_idRow` is the subscription row id used to unsubscribe. |
| `POST /{Model}/{id}/Subscription/Add` | Subscribe. No body. The site merges the response into the page item, so expect `_bAccessorIsSubscribed`, `_idAccessorSubscriptionRow`, `_nSubscriberCount`, `_sSuccessMessage` (field names inferred from how the UI reads them). Members get notifications about what they subscribed to. |
| `DELETE /Subscription/{subscriptionRowId}` | Unsubscribe. Same response idea. |
| `POST /{Model}/{id}/Like`, `DELETE /{Model}/{id}/Like` | Like and unlike. The site picks the verb from `_bAccessorHasLiked`. Silent, nobody is notified. |
| `GET /{Model}/{id}/Config` | `_aAccess` flags for what the signed-in member may do (`Like_Trash`, `Thank_Add`...), plus `_bAccessorIsSubmitter`. Good to check before showing a button. |
| `GET /{Model}/{id}/AccessorCollections`, `POST /Collection/Add`, `POST /{Model}/{id}/AddToCollection` (`{ "_idCollectionRow": n }`), `DELETE /{Model}/{id}/RemoveFromCollection` (body `{ "_idCollectionRow": n }`) | Collections. This is the closest GameBanana has to "favourites" for mods. The first lists `_aAllCollections` (`_idRow`, `_sName`). `Collection/Add` takes `{ _bIsPrivate, _sName, _sPassword }` (from deltamod, password meaning unclear). |
| `POST /{Model}/{id}/Post/Add` | A comment. Body `{ "_sText": "<p>..</p>", "_aImages": [], "_aImageFiles": [], "_aMentionedMemberRowIds": [] }` (from deltamod, not in the site's scripts I read). |
| `POST /{Model}/{id}/Thank/Add` | Body `{ "_nPointsToDonate": 10 }`. The site's picker offers 5, 10 (default), 25, 50, 100, 250, 500 and 1000. With the daily free thank (`_bHasFreeThank`) the picker hides and it still sends 10, which GameBanana pays from its own bank. With `_bAccessorHasThanked` the button says "Rethank" and sends the same call again. The site hides like, subscribe and thank when `_bAccessorIsSubmitter`. Read from the site's `Profile.js` (Nov 2026); the response wasn't captured. |
| `POST /Member/Buddy/{id}/Request` | Buddy request. Notifies the other person. Out of scope. |

Mapping to the app:

- Subscribe to a creator: `setCreatorFlag(c, "sub", on)` stays local. When signed in, also send `Subscription/Add` or
  `DELETE Subscription/{row}`, and undo it from the history entry. The `fav`, `prio` and `blocked` flags stay
  local only, GameBanana has no matching idea.
- After sign-in, offer one button, "Import my subscriptions", which pages through `Member/{id}/Subscriptions` for
  `Member`, `Content` and `Game` and sets the local `sub` flag. Read only, one click.
- The "new from people you subscribe to" feed can be built from public `Mod/Index?_aFilters[Generic_Submitter]=`
  reads. `Member/{id}/SubFeed` is that member's own threads, not a subscription feed.
- Mod favourites: use Like (silent) and Collections. Don't invent a favourites API.
- The mod drawer's stats row does the mod actions (`screens/browse/ModStats.tsx`): the heart likes, the bell subscribes
  (`Mod/{id}/Subscription/Add`, row from the apiv13 `Mod/{id}/ProfilePage`), the gift opens a small box with the cost
  and one Thank button. `gb_mod_me` reads the accessor flags and `UiConfig` points once per opened mod, in the
  background; until it answers, the buttons show what the app remembers (`gb.liked`, `gb.subscribed`, `gb.thanked`).
  Counts come from the guest page read and move by the member's own clicks.

## Content settings

Members pick show, warn or hide for each content rating on GameBanana. `UiConfig` returns them as
`_aContentRatingBehaviors`. Codes seen on mods (Nov 2026), with the guest default:

| Code | Rating | Default |
| --- | --- | --- |
| `sa` | Skimpy Attire | warn |
| `st` | Sexual Themes | warn |
| `sc` | Sexual Content | warn |
| `lp` | Lewd Angles & Poses | warn |
| `pn` | Partial Nudity | hide |
| `nu` | Full Nudity | hide |
| `ft` | Fetishistic | hide |
| `cp` | Crude or Profane | show |
| `iv` | Intense Violence | hide |

`bg`, `au`, `tu`, `du`, `ps` (shown) and `rp` (hidden) are in the list too but weren't seen on any gacha mod. A mod's
`_sInitialVisibility` is the strictest behaviour among its ratings for whoever asks (`sa` + `sc` gives `warn` for a
guest, `sa` + `nu` gives `hide`). Index records carry only that and `_bHasContentRatings`, not the codes, and the app
reads lists without the cookie, so the cards always get the guest answer.

The app's "Mods for adults" is one setting, so `gb_account::adult_pref` folds the first seven codes into it: all `show`
gives Show, all `hide` gives Hide, anything else Blur. The others don't decide it (someone who shows every adult rating
but hides violence still gets Show). `lib/account.ts` applies it, with Undo, when "Match my GameBanana settings"
(`gb.matchAdult`, on by default) is on:

- At sign-in, unless the seven are still GameBanana's defaults: those say nothing about what the person wants, and
  would turn a Show picked in the app back to Blur.
- At each start while signed in, only when the result differs from last time (`gb.adultSeen`). A change made in the
  app stays until the setting on GameBanana changes.
- When the switch is turned on, always.

Nothing is written back to GameBanana. GameBanana's privacy settings have nothing to match in the app (it never
publishes anything about the member beyond the follows and likes they click), so they aren't read.

## Captcha and 2FA

The login page asks for these only when GameBanana decides it needs them. The failed-login answer has
`_aErrorData._sVerificationMethod` of `captcha` (with `_aErrorData._sSiteKey`, a Cloudflare Turnstile key) or `2fa`
(then the page sends `_nTotp`, six digits). A password-posting client can't solve a captcha. The window route gets both
for free because the page's own script does it. The page also sends a browser fingerprint (`_sGTMToken`) that we
couldn't produce from Rust.

Login page facts: only username/password and an email-code tab. No "sign in with Google or Discord", so there is no
OAuth provider refusing embedded browsers. The page's script has no "unsupported browser" check, only a fingerprint
library. Not tested in WebView2 here, but it is Chromium like the Electron window deltamod uses.

## Risks

- **Breakage.** No documentation, no versioning promise. The site's last system update (late October 2026, version 2.2392) was
  a version history overhaul plus 1-click changes, so it is being edited. Keep the whole feature in one module with `available` as the
  off switch, and show "Sign-in isn't working right now" instead of raw errors.
- **Stolen cookie means stolen account.** It allows posting, messages and spending points. Encrypt at rest, never log
  it, never put it in a URL, command line or the settings export, and only send it to `gamebanana.com`.
- **Unknowns.** Session lifetime, cookie names and rate limits. Treat a `401` with `LOGIN_REQUIRED` as "signed out":
  clear the stored header, flip the state, show one toast with a Sign in button.
- **Cloudflare.** It fronts the site. Plain reqwest calls to the public API work today, but a challenge page may appear
  for a signed-in request. If it does, send the webview's User-Agent and the whole cookie jar.
- **Terms.** The Terms of Service (`/wikis/334`) say nothing about bots, scraping, APIs or third-party clients. They do
  let GameBanana suspend access "for any or no reason". The Site Rules (`/rules`) only bear on this at R.6 (messages
  that "appear automated" count as spam) and R.20 (using extra accounts or anything else to farm likes or points).
  A manager that does only what the user just clicked is inside the spirit of both.
- **No official blessing.** GameBanana has a mod-manager enrollment for its "1-click" install button
  (`RemoteInstall/Enroll/{id}`, `RemoteInstall/{fileId}/{alias}`, seen in the site script). That is for queuing
  installs to a registered manager, not for account actions. Not explored, may be worth asking about later.

## Never

- Never ask for, read, type or store the GameBanana username or password. No form for them in the app, no
  `Member/Authenticate` call from Rust.
- Never act without a user click on that exact action. No auto-subscribe, auto-like, bulk subscribe on import, retries
  that repeat a write, or "sync" jobs that push local flags up.
- Never thank (it spends points) without showing the cost on the button and a click for each one.
- Never post a comment the user didn't write and send in the app. Leave buddy requests and messages out.
- Never send the cookie anywhere but `gamebanana.com` and `*.gamebanana.com`, and never to the React side. The UI only
  gets `{ id, name, avatar }`.
- Never keep signing in behind the user's back. When the session dies, say so once and wait.
- Never run writes in a loop. One write per click, and a short pause between two clicks on the same button.
- Every write goes through `record({ label, undo, redo })`: subscribe undoes with `DELETE Subscription/{row}`, like
  with the matching `DELETE`, collection add with `RemoveFromCollection`. Thanks and comments can't be undone, so a
  thanks gets a toast instead, and the box says it can't be taken back.

## What is still unverified

Cookie names and lifetime, the exact write response bodies, Turnstile inside WebView2, whether `incognito` and a second
data folder can coexist, and whether an unusual User-Agent gets challenged on signed-in calls. All of this needs one
real sign-in with a test account before the feature ships.
