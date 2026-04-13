# Starbase — Text-to-Speech Integration

> Port from ExoScopy v1.7.5. Voxtral MLX via mlx-audio server on Ultra96b.

## Architecture

```
[Browser]  →  POST /api/tts/speech  →  [Starbase server]  →  POST /v1/audio/speech  →  [mlx-audio on Ultra96b:8890]
           ←  WAV audio              ←  concat chunks WAV   ←  WAV per chunk
```

- Server splits long text into paragraph-aligned chunks (~1500 chars max)
- Each chunk → one TTS call → one WAV
- Server concatenates PCM + 0.4s silence between chunks → single WAV response
- Frontend caches WAV blobs in memory for instant replay + download

## Backend: mlx-audio server (already running)

Ultra96b (192.168.86.42), port 8890:
```
/Library/Frameworks/Python.framework/Versions/3.12/bin/mlx_audio.server --host 0.0.0.0 --port 8890
```

Model: `mlx-community/Voxtral-4B-TTS-2603-mlx-6bit`
Voices FR: `fr_female`, `fr_male`
Voices EN: `casual_male`, `casual_female`, `cheerful_female`, `neutral_male`, `neutral_female`

---

## 1. Settings (server/settings.js)

Add to DEFAULTS:

```javascript
// Text-to-Speech (Voxtral MLX / OpenAI-compatible)
tts: {
  enabled: false,
  endpoint: '',
  voice: 'fr_female',
  model: 'mlx-community/Voxtral-4B-TTS-2603-mlx-6bit',
},
```

---

## 2. Server routes (server/index.js)

Add these 3 helper functions + 2 routes. Place them in their own section.

### 2a. Text chunking (preserves paragraph boundaries for natural intonation)

```javascript
// TTS: split text into chunks at paragraph/sentence boundaries
function splitTtsChunks(text, maxChars = 1500) {
  const paragraphs = text.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean);
  const chunks = [];
  let current = '';

  for (const para of paragraphs) {
    if (current.length + para.length + 2 <= maxChars) {
      current = current ? current + '\n\n' + para : para;
      continue;
    }
    if (current) { chunks.push(current); current = ''; }
    if (para.length <= maxChars) {
      current = para;
    } else {
      // Split long paragraph at sentence boundaries
      const sentences = para.split(/(?<=[.!?…])\s+/);
      for (const s of sentences) {
        if (current.length + s.length + 1 <= maxChars) {
          current = current ? current + ' ' + s : s;
        } else {
          if (current) chunks.push(current);
          current = s;
        }
      }
    }
  }
  if (current) chunks.push(current);
  return chunks;
}
```

### 2b. WAV parse/build helpers

```javascript
// TTS: extract raw PCM from WAV buffer (skip RIFF/fmt/data headers)
function extractPcm(wavBuf) {
  let pos = 12; // skip RIFF header
  let sampleRate = 24000, numChannels = 1, bitsPerSample = 16, pcm = null;
  while (pos < wavBuf.length - 8) {
    const id = wavBuf.slice(pos, pos + 4).toString('ascii');
    const size = wavBuf.readUInt32LE(pos + 4);
    if (id === 'fmt ') {
      numChannels = wavBuf.readUInt16LE(pos + 10);
      sampleRate = wavBuf.readUInt32LE(pos + 12);
      bitsPerSample = wavBuf.readUInt16LE(pos + 22);
    } else if (id === 'data') {
      pcm = wavBuf.slice(pos + 8, pos + 8 + size);
    }
    pos += 8 + size;
    if (pos % 2 === 1) pos++;
  }
  return { pcm: pcm || Buffer.alloc(0), sampleRate, numChannels, bitsPerSample };
}

// TTS: build WAV from raw PCM
function buildWav(pcm, sampleRate, numChannels, bitsPerSample) {
  const byteRate = sampleRate * numChannels * bitsPerSample / 8;
  const blockAlign = numChannels * bitsPerSample / 8;
  const header = Buffer.alloc(44);
  header.write('RIFF', 0); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVE', 8);
  header.write('fmt ', 12); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20);
  header.writeUInt16LE(numChannels, 22); header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28); header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}
```

### 2c. Routes

```javascript
// ─────────────────────────────────────────────────────────────────────────────
// TTS API (proxies to Voxtral MLX / OpenAI-compatible TTS endpoint)
// ─────────────────────────────────────────────────────────────────────────────

// GET /api/tts/voices — list available voices
app.get('/api/tts/voices', async (req, res) => {
  const settings = getSettings();
  if (!settings.tts?.enabled || !settings.tts?.endpoint) {
    return res.status(400).json({ error: 'TTS not configured' });
  }
  try {
    const r = await fetch(`${settings.tts.endpoint}/v1/audio/voices`);
    if (!r.ok) throw new Error(`TTS endpoint returned ${r.status}`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.status(502).json({ error: `TTS voices fetch failed: ${e.message}` });
  }
});

// POST /api/tts/speech — generate speech audio (with auto-chunking)
app.post('/api/tts/speech', async (req, res) => {
  const settings = getSettings();
  if (!settings.tts?.enabled || !settings.tts?.endpoint) {
    return res.status(400).json({ error: 'TTS not configured' });
  }
  const { input, voice, response_format } = req.body;
  if (!input) return res.status(400).json({ error: 'input is required' });

  const chunks = splitTtsChunks(input);
  const ttsVoice = voice || settings.tts.voice || 'fr_female';
  const ttsModel = settings.tts.model || 'mlx-community/Voxtral-4B-TTS-2603-mlx-6bit';
  const fmt = response_format || 'wav';

  try {
    const pcmParts = [];
    let sampleRate = 24000, numChannels = 1, bitsPerSample = 16;
    const silenceDuration = 0.4; // seconds between chunks

    for (let i = 0; i < chunks.length; i++) {
      const r = await fetch(`${settings.tts.endpoint}/v1/audio/speech`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ input: chunks[i], model: ttsModel, voice: ttsVoice, response_format: fmt }),
      });
      if (!r.ok) {
        const errText = await r.text().catch(() => '');
        throw new Error(`TTS returned ${r.status}: ${errText}`);
      }
      const wavBuf = Buffer.from(await r.arrayBuffer());
      const { pcm, sampleRate: sr, numChannels: nc, bitsPerSample: bps } = extractPcm(wavBuf);
      sampleRate = sr; numChannels = nc; bitsPerSample = bps;
      pcmParts.push(pcm);

      // Add silence between chunks
      if (i < chunks.length - 1) {
        const silenceBytes = Math.round(silenceDuration * sr * nc * bps / 8);
        pcmParts.push(Buffer.alloc(silenceBytes));
      }
    }

    const fullPcm = Buffer.concat(pcmParts);
    const wav = buildWav(fullPcm, sampleRate, numChannels, bitsPerSample);
    res.set('Content-Type', 'audio/wav');
    res.send(wav);
  } catch (e) {
    res.status(502).json({ error: `TTS speech failed: ${e.message}` });
  }
});
```

---

## 3. Frontend: Settings page (SettingsPage component)

### 3a. State variables (inside SettingsPage function)

```javascript
// TTS
const [ttsEnabled, setTtsEnabled] = useState(settings?.tts?.enabled || false);
const [ttsEndpoint, setTtsEndpoint] = useState(settings?.tts?.endpoint || '');
const [ttsVoice, setTtsVoice] = useState(settings?.tts?.voice || 'fr_female');
const [ttsModel, setTtsModel] = useState(settings?.tts?.model || 'mlx-community/Voxtral-4B-TTS-2603-mlx-6bit');
```

### 3b. Sync on settings change (in useEffect that watches `settings`)

```javascript
setTtsEnabled(settings.tts?.enabled || false);
setTtsEndpoint(settings.tts?.endpoint || '');
setTtsVoice(settings.tts?.voice || 'fr_female');
setTtsModel(settings.tts?.model || 'mlx-community/Voxtral-4B-TTS-2603-mlx-6bit');
```

### 3c. Include in save() function

```javascript
tts: { enabled: ttsEnabled, endpoint: ttsEndpoint, voice: ttsVoice, model: ttsModel },
```

### 3d. Settings UI section (place after OpenRouter, before Admin Mode)

```jsx
{/* Text-to-Speech */}
<div className="flex flex-col gap-2.5">
  <span className="text-sm font-semibold text-gray-900">Text-to-Speech (Voxtral / OpenAI-compatible)</span>
  <p className="text-xs text-gray-400">Connect to a TTS endpoint to add a play button on assistant messages. Supports mlx-audio server or any OpenAI-compatible TTS API.</p>
  <div className="flex items-center gap-4">
    <button onClick={() => setTtsEnabled(!ttsEnabled)}
      className={`relative w-11 h-6 rounded-full transition-colors ${ttsEnabled ? 'bg-indigo-500' : 'bg-gray-300'}`}>
      <div className={`absolute top-0.5 w-5 h-5 bg-white rounded-full shadow transition-transform ${ttsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`} />
    </button>
    <span className="text-xs text-gray-600">{ttsEnabled ? 'Enabled' : 'Disabled'}</span>
  </div>
  {ttsEnabled && (
    <div className="flex flex-col gap-2 ml-1">
      <div className="flex gap-3 items-center">
        <label className="text-xs text-gray-500 w-[80px]">Endpoint</label>
        <input type="text" value={ttsEndpoint} onChange={e => setTtsEndpoint(e.target.value)}
          placeholder="http://192.168.86.42:8890" className="mono text-[13px] px-3 py-2 border border-gray-200 rounded-lg bg-white w-[350px]" />
      </div>
      <div className="flex gap-3 items-center">
        <label className="text-xs text-gray-500 w-[80px]">Voice</label>
        <input type="text" value={ttsVoice} onChange={e => setTtsVoice(e.target.value)}
          placeholder="fr_female" className="mono text-[13px] px-3 py-2 border border-gray-200 rounded-lg bg-white w-[200px]" />
      </div>
      <div className="flex gap-3 items-center">
        <label className="text-xs text-gray-500 w-[80px]">Model</label>
        <input type="text" value={ttsModel} onChange={e => setTtsModel(e.target.value)}
          placeholder="mlx-community/Voxtral-4B-TTS-2603-mlx-6bit" className="mono text-[13px] px-3 py-2 border border-gray-200 rounded-lg bg-white w-[200px]" />
      </div>
    </div>
  )}
</div>
```

---

## 4. Frontend: Chat page (ChatPage component)

### 4a. State + refs (inside ChatPage function, after other refs)

```javascript
// TTS playback
const [ttsPlaying, setTtsPlaying] = useState(null); // message index currently playing
const [ttsLoading, setTtsLoading] = useState(null); // message index loading
const ttsAudioRef = useRef(null);
const ttsCacheRef = useRef({}); // msgIdx → { blob, url }
```

### 4b. playTts + saveTts functions

```javascript
async function playTts(text, msgIdx) {
  // Stop if already playing this message
  if (ttsPlaying === msgIdx) {
    if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
    setTtsPlaying(null);
    return;
  }
  // Stop any previous playback
  if (ttsAudioRef.current) { ttsAudioRef.current.pause(); ttsAudioRef.current = null; }
  setTtsPlaying(null);

  // Check cache first
  const cached = ttsCacheRef.current[msgIdx];
  if (cached) {
    const audio = new Audio(cached.url);
    ttsAudioRef.current = audio;
    audio.onended = () => { setTtsPlaying(null); ttsAudioRef.current = null; };
    audio.onerror = () => { setTtsPlaying(null); ttsAudioRef.current = null; };
    setTtsPlaying(msgIdx);
    audio.play();
    return;
  }

  setTtsLoading(msgIdx);
  try {
    // Strip markdown/thinking for cleaner speech
    const clean = text
      .replace(/<think>[\s\S]*?<\/think>/g, '')
      .replace(/```[\s\S]*?```/g, '')
      .replace(/[#*_`~>\[\]()!|]/g, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    if (!clean) { setTtsLoading(null); return; }
    const res = await fetch('/api/tts/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ input: clean }),
    });
    if (!res.ok) throw new Error('TTS failed');
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    // Cache for replay and save
    ttsCacheRef.current[msgIdx] = { blob, url };
    const audio = new Audio(url);
    ttsAudioRef.current = audio;
    audio.onended = () => { setTtsPlaying(null); ttsAudioRef.current = null; };
    audio.onerror = () => { setTtsPlaying(null); ttsAudioRef.current = null; };
    setTtsLoading(null);
    setTtsPlaying(msgIdx);
    audio.play();
  } catch (e) {
    console.error('TTS error:', e);
    setTtsLoading(null);
  }
}

function saveTts(msgIdx) {
  const cached = ttsCacheRef.current[msgIdx];
  if (!cached) return;
  const a = document.createElement('a');
  a.href = cached.url;
  a.download = `speech-${msgIdx}.wav`;
  a.click();
}
```

### 4c. Buttons in assistant message bubble

Place inside the hover toolbar div, after the existing Copy/Save buttons.
**Important**: wrap Play + WAV buttons in a JSX fragment `<>...</>`.

```jsx
{settings?.tts?.enabled && (<>
  <button onClick={() => playTts(msg.content, i)}
    disabled={ttsLoading === i}
    className={`px-2 py-1 bg-white/90 border border-gray-200 rounded-md backdrop-blur-sm flex items-center gap-1 ${ttsPlaying === i ? 'text-indigo-500 border-indigo-300' : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'}`}>
    {ttsLoading === i ? (
      <><svg className="animate-spin" width="12" height="12" viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeDasharray="31.4 31.4" strokeLinecap="round"/></svg><span className="text-[10px]">Loading</span></>
    ) : ttsPlaying === i ? (
      <><svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg><span className="text-[10px]">Stop</span></>
    ) : (
      <><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"/><path d="M15.54 8.46a5 5 0 0 1 0 7.07"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14"/></svg><span className="text-[10px]">Play</span></>
    )}
  </button>
  <button onClick={() => saveTts(i)}
    disabled={!ttsCacheRef.current[i]}
    className={`px-2 py-1 bg-white/90 border border-gray-200 rounded-md backdrop-blur-sm flex items-center gap-1 ${ttsCacheRef.current[i] ? 'text-gray-500 hover:bg-gray-100 hover:text-gray-700' : 'text-gray-300 cursor-default'}`}>
    {Icons.download(ttsCacheRef.current[i] ? '#6b7280' : '#d1d5db')}<span className="text-[10px]">WAV</span>
  </button>
</>)}
```

---

## 5. Configuration values

Once deployed, in Settings → Text-to-Speech:

| Field | Value |
|-------|-------|
| Enabled | On |
| Endpoint | `http://192.168.86.42:8890` |
| Voice | `fr_female` |
| Model | `mlx-community/Voxtral-4B-TTS-2603-mlx-6bit` |

---

## Key design decisions

- **Chunk at paragraphs, never mid-sentence**: Voxtral's intonation depends on full paragraph context. Cutting mid-sentence produces unnatural prosody.
- **~1500 char limit per chunk**: Voxtral cuts off around ~1700 chars. 1500 gives margin.
- **0.4s silence between chunks**: Natural pause, adjustable in `silenceDuration`.
- **WAV not MP3**: Ultra96b doesn't have ffmpeg installed. WAV works natively.
- **Cache in browser memory**: `ttsCacheRef` (a ref, not state) stores blob URLs per message index. Replay is instant, no re-generation. Clear on page refresh.
- **Server-side proxy**: Frontend never calls TTS endpoint directly (CORS + config encapsulation).
