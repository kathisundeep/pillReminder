# Versioning

Three numbers travel with the app and they are not the same number. Confusing
them is how installed apps silently stop receiving updates.

| Field | Example | Who sees it | When it changes |
|---|---|---|---|
| `expo.version` | `0.0.1` | Users — login screen, Settings, store listing | **Every change** (`npm run bump`) |
| `expo.runtimeVersion` | `1.1.0` | Nobody | Only with a new native build |
| `expo.android.versionCode` | `4` | Google Play only | Every store upload; only ever increases |

## The app version

A change counter, not a semver claim. Each position runs `0..99` and rolls over:

```
0.0.1 -> 0.0.2 -> … -> 0.0.99 -> 0.1.0 -> … -> 0.99.99 -> 1.0.0
```

```bash
npm run bump       # 0.0.1 -> 0.0.2, and bumps versionCode
npm run version    # just print the current one
```

It appears at the bottom of the login screen, beside what is running:

```
v0.0.1 · as installed     <- the APK's own bundle, no update applied
v0.0.2 · 019feb70         <- update 019feb70 is live
```

That line is on the login screen specifically because it must be readable
**before** anyone has an account. It is also in Settings, but Settings is behind
a login — and the moment you most need to know which build is running is when
registration itself is misbehaving.

## The runtime version — the one that bites

`runtimeVersion` is the contract between an installed binary and the updates it
will accept. A phone asks the update server for *its* runtime version and gets
back only updates published for that exact string. No match, no update, no
error — the app simply reports itself up to date forever.

It used to be `{ policy: "appVersion" }`, deriving it from `expo.version`. That
is a sensible default when the version moves only at releases. It is actively
harmful here, because the version now moves on every edit: each bump would mint
a new runtime, orphan every phone in the field, and require a new APK for a
one-line copy change.

So it is **pinned to a literal string**, and `npm run bump` never touches it.

### When to change it

Only alongside a new native build — a new native module, a permission, an
`app.json` plugin change. Then:

1. Change `runtimeVersion` in `app.json`
2. `eas build -p android --profile preview`
3. `npm run qr` — new QR for the new APK
4. Everyone must reinstall; older installs will not receive updates again

Changing it without shipping a binary that reports the same value cuts every
user off from updates, and nothing anywhere will say so. A test asserts the
current value for exactly this reason — if you mean to change it, the failing
test is the reminder to do the four steps above.

## Shipping a change

```bash
npm run bump
npm test
npm run update      # eas update, signed with keys/private-key.pem
```

Installed apps pick it up on next foreground. The version on the login screen
is how you confirm it landed: if the number you just bumped to is showing, the
update applied.

## Signed updates

Updates are signed. A build carries `certs/certificate.pem` and refuses any
update that is not signed by the matching private key, so someone who takes the
Expo account alone cannot push code to anyone's phone.

- `keys/private-key.pem` is **not in git** (see `.gitignore`) — back it up
  somewhere safe. Publishing needs it, which is why `npm run update` exists;
  plain `eas update` publishes an update that signed builds will reject.
- `certs/certificate.pem` **is** in git: it is public, and the build embeds it.
- Losing the private key means generating a new pair
  (`npx expo-updates codesigning:generate …`), pointing `app.json` at the new
  certificate, and building a new APK — every installed app has the old
  certificate and will refuse updates signed with anything else.
- Builds made before signing was added (v0.0.8 and earlier) ignore the
  signature; they keep updating as before.
