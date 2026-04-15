'use strict';

// ─────────────────────────────────────────────────────────────────────────────
// ExoScopy — Web Tools for LLM function calling
// Ported from Inferencer Pro (Python → Node.js)
// ─────────────────────────────────────────────────────────────────────────────

const fs = require('fs');
const path = require('path');

const CACHE_DIR = path.join(__dirname, '..', 'data', 'web_cache');
const CACHE_TTL = 24 * 60 * 60 * 1000; // 1 day

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
  'Accept-Language': 'en-US,en;q=0.9',
  'Connection': 'keep-alive',
};

// ─── Cache helpers ───────────────────────────────────────────────────────────

function safeCacheFile(url) {
  if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
  const safe = url.replace(/[^a-zA-Z0-9]/g, '_').slice(0, 200);
  return path.join(CACHE_DIR, safe + '.html');
}

function readCache(cacheFile) {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    const stat = fs.statSync(cacheFile);
    if (Date.now() - stat.mtimeMs > CACHE_TTL) return null; // expired
    return fs.readFileSync(cacheFile, 'utf8');
  } catch { return null; }
}

function readCacheStale(cacheFile) {
  try {
    if (!fs.existsSync(cacheFile)) return null;
    return fs.readFileSync(cacheFile, 'utf8');
  } catch { return null; }
}

function writeCache(cacheFile, text) {
  try { fs.writeFileSync(cacheFile, text, 'utf8'); } catch {}
}

// ─── HTML → clean text ──────────────────────────────────────────────────────

function stripHtml(html) {
  let text = html;
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  text = text.replace(/<!--[\s\S]*?-->/g, '');
  text = text.replace(/<[^>]+>/g, ' ');
  // Decode HTML entities
  text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(n))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
  // Collapse whitespace
  text = text.replace(/\n+/g, '\n').replace(/[ \t]+/g, ' ').trim();
  return text;
}

// ─── Fetch helper ────────────────────────────────────────────────────────────

async function fetchPage(url) {
  const cacheFile = safeCacheFile(url);
  const cached = readCache(cacheFile);
  if (cached) return { text: cached, fromCache: true, cacheFile };

  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10000);
    const res = await fetch(url, { headers: HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    writeCache(cacheFile, text);
    return { text, fromCache: false, cacheFile };
  } catch (e) {
    // Fallback to stale cache
    const stale = readCacheStale(cacheFile);
    if (stale) return { text: stale, fromCache: true, cacheFile };
    throw e;
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TOOL DEFINITIONS (OpenAI function calling format)
// ═════════════════════════════════════════════════════════════════════════════

const TOOL_DEFINITIONS = [
  {
    type: 'function',
    function: {
      name: 'web_search',
      description: 'Search the web using DuckDuckGo. Returns titles, links, and snippets.',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: 'The search query' },
          num_results: { type: 'integer', description: 'Number of results (default 5)', minimum: 1, maximum: 20 },
        },
        required: ['query'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch',
      description: 'Fetch a webpage and return its text content (max 8000 chars by default). Use start_pos for pagination.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The complete URL of the webpage to fetch' },
          start_pos: { type: 'integer', default: 0, minimum: 0, description: 'Start from this character position' },
          max_length: { type: 'integer', default: 8000, description: 'Maximum characters to return' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'web_fetch_full',
      description: 'Fetch entire webpage content. WARNING: may be very large. Use web_fetch with pagination for large pages.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'The complete URL of the webpage to fetch' },
        },
        required: ['url'],
      },
    },
  },
];

// ═════════════════════════════════════════════════════════════════════════════
// TOOL IMPLEMENTATIONS
// ═════════════════════════════════════════════════════════════════════════════

async function webSearch(query, numResults = 5) {
  const url = `https://lite.duckduckgo.com/lite/?q=${encodeURIComponent(query)}`;

  try {
    const { text: html } = await fetchPage(url);

    // Parse DuckDuckGo Lite results
    const results = [];
    const sections = html.split(/<tr>\s*<td[^>]*valign="top"[^>]*>\s*\d+\.\s*&nbsp;\s*<\/td>/);

    for (let i = 1; i <= numResults && i < sections.length; i++) {
      const section = sections[i];
      const hrefParts = section.split('href=');
      if (hrefParts.length <= 1) continue;

      const hrefPart = hrefParts[1];
      const quoteChar = hrefPart[0];
      const hrefSplit = hrefPart.split(quoteChar);
      if (hrefSplit.length <= 1) continue;

      const rawLink = hrefSplit[1];
      // Extract actual URL from DDG redirect
      let link = rawLink;
      try {
        const parsed = new URL(rawLink, 'https://lite.duckduckgo.com');
        const uddg = parsed.searchParams.get('uddg');
        if (uddg) link = uddg;
      } catch {}

      // Extract title
      const titleMatch = hrefPart.match(/>([^<]+)<\/a>/);
      const title = titleMatch ? decodeEntities(titleMatch[1].trim()) : '';

      // Extract snippet
      let snippet = '';
      const snippetMatch = section.match(/class='result-snippet'[^>]*>([^<]+)<\/td>/);
      if (snippetMatch) snippet = decodeEntities(snippetMatch[1].trim());

      results.push({ title, link, snippet });
    }

    const info = { query, results, result_count: results.length };
    if (!results.length) {
      if (html.includes('anomaly-modal__description')) {
        info.error = 'too many requests: captcha challenge required';
      } else {
        info.message = 'No web search results found. Try a different query.';
      }
    }
    return JSON.stringify(info);
  } catch (e) {
    return JSON.stringify({ query, results: [], error: `web_search failed: ${e.message}` });
  }
}

function decodeEntities(str) {
  return str.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

async function webFetch(url, startPos = 0, maxLength = 8000) {
  try {
    const { text: html } = await fetchPage(url);
    const text = stripHtml(html);
    const content = text.slice(Math.max(0, startPos), Math.max(0, startPos) + maxLength);
    return JSON.stringify({ url, content, content_length: content.length, total_length: text.length });
  } catch (e) {
    return JSON.stringify({ url, content: '', error: `web_fetch failed: ${e.message}` });
  }
}

async function webFetchFull(url) {
  try {
    const { text: html } = await fetchPage(url);
    const text = stripHtml(html);
    return JSON.stringify({ url, content: text, content_length: text.length });
  } catch (e) {
    return JSON.stringify({ url, content: '', error: `web_fetch_full failed: ${e.message}` });
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// TOOL EXECUTOR
// ═════════════════════════════════════════════════════════════════════════════

async function executeTool(name, args) {
  console.log(`[tools] Executing ${name}(${JSON.stringify(args)})`);
  switch (name) {
    case 'web_search':
      return await webSearch(args.query, args.num_results);
    case 'web_fetch':
      return await webFetch(args.url, args.start_pos, args.max_length);
    case 'web_fetch_full':
      return await webFetchFull(args.url);
    default:
      return JSON.stringify({ error: `Unknown tool: ${name}` });
  }
}

module.exports = { TOOL_DEFINITIONS, executeTool };
