# Score Link Importer (Archived)

This service is retained only as historical/reference code. NoteRain no longer
starts, proxies, or deploys it. The current product flow is browser-only:
Tampermonkey collects the authorized MIDI and SVG resources, computes the
MuseScore request signature locally, and returns the result directly to the
NoteRain opener tab with `postMessage`.

This workspace is an isolated session bridge for collecting public, free,
downloadable score resources. It does not depend on NoteRain client code.

## API

```http
POST /v1/sessions
Content-Type: application/json

{"url":"https://musescore.com/user/16006641/scores/4197961"}
```

The response contains a one-time MuseScore launch URL. The browser companion
collects base64 MIDI and SVG pages in the user's already-authorized MuseScore
page, then posts them to the session. The consumer polls the session and owns
MusicXML reconstruction.

## Browser companion

MuseScore currently places stateless server requests behind a Cloudflare human
verification page. Like `dl-librescore`, this importer runs collection code in
the user's real MuseScore page instead of trying to bypass that challenge.

Install Tampermonkey, then open this URL from the NoteRain link import dialog:

```text
/api/score-link/v1/companion.user.js
```

The companion only activates when a URL contains a valid one-time NoteRain import
fragment. It removes the fragment immediately, reads the public page state,
downloads resources with the browser's existing authorization, and posts the
result to the short-lived session.

NoteRain first loads the launch URL in a visually hidden iframe. If the companion
finishes within four seconds, the import stays silent. Otherwise NoteRain reveals
an interaction panel so the user can complete a challenge. MuseScore may deny
framing through `X-Frame-Options` or CSP; the panel therefore also offers “Open
in new tab”. The same one-time session remains valid in either surface.

Do not provide user cookies to this service. Scores that are not public, free,
and marked downloadable are rejected.

## Production URL

The callback embedded in the MuseScore launch URL must be reachable from the
user's browser. Behind the bundled Nginx proxy it is inferred automatically. For
a separately deployed importer set:

```bash
PUBLIC_BASE_URL=https://noterain.example/api/score-link npm start -w importer
```

## Extraction boundary

The portable client feature lives in
`client/src/features/score-link-import/`. Its `core/` directory only depends on
the collection contract and `midi-file`, so it can be moved into a standalone
web project without NoteRain stores or components.