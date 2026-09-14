import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const VIDEOS_DIR = path.join(ROOT, "videos");
const PORT = Number(process.env.PORT) || 3456;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".xml": "application/xml; charset=utf-8",
  ".m4s": "video/mp4",
  ".mp4": "video/mp4",
  ".m4a": "audio/mp4",
};

const catalog = new Map();

function decodeXmlEntities(text) {
  return text
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) =>
      String.fromCodePoint(parseInt(n, 16)),
    )
    .replace(/&amp;/g, "&");
}

function parseDanmakuXml(xml) {
  const comments = [];
  const re = /<d p="([^"]+)">([\s\S]*?)<\/d>/g;
  let match;
  while ((match = re.exec(xml))) {
    const fields = match[1].split(",");
    const time = Number(fields[0]);
    if (!Number.isFinite(time)) continue;
    const text = decodeXmlEntities(match[2]).trim();
    if (!text) continue;
    comments.push({
      time,
      mode: Number(fields[1]) || 1,
      size: Number(fields[2]) || 25,
      color: Number(fields[3]) || 16777215,
      text,
    });
  }
  comments.sort((a, b) => a.time - b.time);
  return comments;
}

function findMediaPair(folder, preferredTag) {
  const candidates = [];
  if (preferredTag) candidates.push(preferredTag);
  try {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.isDirectory() && !candidates.includes(entry.name)) {
        candidates.push(entry.name);
      }
    }
  } catch {
    return null;
  }

  for (const tag of candidates) {
    const dir = path.join(folder, tag);
    const video = path.join(dir, "video.m4s");
    const audio = path.join(dir, "audio.m4s");
    if (fs.existsSync(video) && fs.existsSync(audio)) {
      return { tag, video, audio };
    }
  }
  return null;
}

function rebuildCatalog() {
  catalog.clear();
  if (!fs.existsSync(VIDEOS_DIR)) return;

  for (const dirent of fs.readdirSync(VIDEOS_DIR, { withFileTypes: true })) {
    if (!dirent.isDirectory()) continue;
    const folder = path.join(VIDEOS_DIR, dirent.name);
    const entryPath = path.join(folder, "entry.json");
    if (!fs.existsSync(entryPath)) continue;

    let entry;
    try {
      entry = JSON.parse(fs.readFileSync(entryPath, "utf8"));
    } catch {
      continue;
    }

    const media = findMediaPair(folder, String(entry.type_tag || ""));
    if (!media) continue;

    const cid = String(entry.page_data?.cid || dirent.name.replace(/^c_/, ""));
    const coverPath = path.join(folder, "cover.jpg");
    const danmakuPath = path.join(folder, "danmaku.xml");

    catalog.set(cid, {
      cid,
      folder: dirent.name,
      entry,
      videoPath: media.video,
      audioPath: media.audio,
      coverPath: fs.existsSync(coverPath) ? coverPath : null,
      danmakuPath: fs.existsSync(danmakuPath) ? danmakuPath : null,
      qualityTag: media.tag,
    });
  }
}

function buildLibrary() {
  rebuildCatalog();
  const groups = new Map();

  for (const item of catalog.values()) {
    const { entry, cid, qualityTag } = item;
    const bvid = entry.bvid || `av${entry.avid || cid}`;
    if (!groups.has(bvid)) {
      groups.set(bvid, {
        bvid,
        avid: entry.avid || null,
        title: entry.title || "未命名视频",
        ownerName: entry.owner_name || "未知 UP",
        ownerId: entry.owner_id || null,
        coverUrl: item.coverPath ? `/media/${cid}/cover` : "",
        parts: [],
      });
    }

    const page = entry.page_data || {};
    groups.get(bvid).parts.push({
      cid,
      page: Number(page.page) || 1,
      part: page.part || `P${page.page || 1}`,
      durationMs: Number(entry.total_time_milli) || 0,
      quality: entry.quality_pithy_description || qualityTag,
      width: page.width || 0,
      height: page.height || 0,
      danmakuCount: Number(entry.danmaku_count) || 0,
      videoUrl: `/media/${cid}/video`,
      audioUrl: `/media/${cid}/audio`,
      coverUrl: item.coverPath ? `/media/${cid}/cover` : "",
      danmakuUrl: `/api/videos/${cid}/danmaku`,
    });
  }

  const library = [...groups.values()].map((group) => {
    group.parts.sort((a, b) => a.page - b.page);
    return group;
  });
  library.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
  return library;
}

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(body),
    "Cache-Control": "no-store",
  });
  res.end(body);
}

function sendText(res, status, text, type = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": type });
  res.end(text);
}

function parseRange(header, size) {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header || "");
  if (!match) return null;
  let start = match[1] === "" ? null : Number(match[1]);
  let end = match[2] === "" ? null : Number(match[2]);
  if (start === null && end === null) return null;
  if (start === null) {
    start = Math.max(0, size - end);
    end = size - 1;
  } else if (end === null || end >= size) {
    end = size - 1;
  }
  if (start < 0 || start > end || start >= size) return null;
  return { start, end };
}

function sendFile(req, res, filePath, contentType) {
  fs.stat(filePath, (err, stat) => {
    if (err || !stat.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }

    const range = parseRange(req.headers.range, stat.size);
    if (req.headers.range && !range) {
      res.writeHead(416, {
        "Content-Range": `bytes */${stat.size}`,
      });
      res.end();
      return;
    }

    const start = range ? range.start : 0;
    const end = range ? range.end : stat.size - 1;
    const headers = {
      "Content-Type": contentType,
      "Accept-Ranges": "bytes",
      "Content-Length": end - start + 1,
      "Cache-Control": "public, max-age=3600",
    };
    if (range) headers["Content-Range"] = `bytes ${start}-${end}/${stat.size}`;

    res.writeHead(range ? 206 : 200, headers);
    if (req.method === "HEAD") {
      res.end();
      return;
    }
    const stream = fs.createReadStream(filePath, { start, end });
    stream.on("error", () => {
      if (!res.headersSent) sendText(res, 500, "Read error");
      else res.destroy();
    });
    stream.pipe(res);
  });
}

function safeCid(value) {
  return /^[A-Za-z0-9_]+$/.test(value || "") ? value : null;
}

function servePublic(req, res, urlPath) {
  const relative = urlPath === "/" ? "index.html" : urlPath.replace(/^\/+/, "");
  const resolved = path.normalize(path.join(PUBLIC_DIR, relative));
  if (!resolved.startsWith(PUBLIC_DIR)) {
    sendText(res, 403, "Forbidden");
    return;
  }
  fs.stat(resolved, (err, stat) => {
    if (err || !stat.isFile()) {
      sendText(res, 404, "Not Found");
      return;
    }
    const type = MIME[path.extname(resolved).toLowerCase()] || "application/octet-stream";
    sendFile(req, res, resolved, type);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || "localhost"}`);
  const pathname = decodeURIComponent(url.pathname);

  if (req.method !== "GET" && req.method !== "HEAD") {
    sendText(res, 405, "Method Not Allowed");
    return;
  }

  if (pathname === "/api/library") {
    sendJson(res, 200, { groups: buildLibrary() });
    return;
  }

  const danmakuMatch = pathname.match(/^\/api\/videos\/([^/]+)\/danmaku$/);
  if (danmakuMatch) {
    const cid = safeCid(danmakuMatch[1]);
    rebuildCatalog();
    const item = cid && catalog.get(cid);
    if (!item?.danmakuPath) {
      sendJson(res, 200, { comments: [] });
      return;
    }
    try {
      const xml = fs.readFileSync(item.danmakuPath, "utf8");
      sendJson(res, 200, { comments: parseDanmakuXml(xml) });
    } catch {
      sendJson(res, 200, { comments: [] });
    }
    return;
  }

  const mediaMatch = pathname.match(/^\/media\/([^/]+)\/(video|audio|cover)$/);
  if (mediaMatch) {
    const cid = safeCid(mediaMatch[1]);
    rebuildCatalog();
    const item = cid && catalog.get(cid);
    if (!item) {
      sendText(res, 404, "Not Found");
      return;
    }
    if (mediaMatch[2] === "video") {
      sendFile(req, res, item.videoPath, "video/mp4");
      return;
    }
    if (mediaMatch[2] === "audio") {
      sendFile(req, res, item.audioPath, "audio/mp4");
      return;
    }
    if (item.coverPath) {
      sendFile(req, res, item.coverPath, "image/jpeg");
      return;
    }
    sendText(res, 404, "Not Found");
    return;
  }

  servePublic(req, res, pathname);
});

rebuildCatalog();
server.listen(PORT, "127.0.0.1", () => {
  console.log(`BiliPlayer: http://127.0.0.1:${PORT}`);
  console.log(`已识别缓存分集: ${catalog.size}`);
});
