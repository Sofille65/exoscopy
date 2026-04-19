# Vendor libraries

All frontend dependencies for ExoScopy, self-hosted here so the app works fully offline / on air-gapped networks. No CDN calls at runtime.

| File | Source | Purpose |
|------|--------|---------|
| `react.production.min.js` | https://unpkg.com/react@18/umd/react.production.min.js | React 18 runtime |
| `react-dom.production.min.js` | https://unpkg.com/react-dom@18/umd/react-dom.production.min.js | React DOM renderer |
| `babel.min.js` | https://unpkg.com/@babel/standalone/babel.min.js | In-browser JSX → JS transform |
| `tailwind.min.js` | https://cdn.tailwindcss.com | Tailwind Play CDN (runtime JIT) |
| `socket.io.min.js` | https://cdn.socket.io/4.7.4/socket.io.min.js | Socket.IO client |
| `marked.min.js` | https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js | Markdown rendering |
| `jszip.min.js` | https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js | Code block export as .zip |
| `pdf.min.js` | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js | PDF parsing (main lib) |
| `pdf.worker.min.js` | https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js | PDF parsing (worker) |

**Total:** ~5 MB.

## Refresh all vendor files

```bash
cd public/vendor
curl -sSL -o react.production.min.js      https://unpkg.com/react@18/umd/react.production.min.js
curl -sSL -o react-dom.production.min.js  https://unpkg.com/react-dom@18/umd/react-dom.production.min.js
curl -sSL -o babel.min.js                 https://unpkg.com/@babel/standalone/babel.min.js
curl -sSL -o tailwind.min.js              https://cdn.tailwindcss.com
curl -sSL -o socket.io.min.js             https://cdn.socket.io/4.7.4/socket.io.min.js
curl -sSL -o marked.min.js                https://cdn.jsdelivr.net/npm/marked@12.0.2/marked.min.js
curl -sSL -o jszip.min.js                 https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js
curl -sSL -o pdf.min.js                   https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js
curl -sSL -o pdf.worker.min.js            https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js
```

## Notes

- When upgrading `pdf.js`, bump **both** `pdf.min.js` AND `pdf.worker.min.js` to the same version — they must match.
- When upgrading any lib: test the in-browser app end-to-end, then commit. These files are committed to the repo on purpose so Docker builds are deterministic and offline-capable.
- Do **not** use `pdf.js` 4.x — it requires `type="module"` which breaks our no-build-step philosophy. Stay on 3.x.
