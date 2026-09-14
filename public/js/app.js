import { DanmakuEngine } from "./danmaku.js";
import { DualPlayer, formatTime } from "./player.js";

const STORAGE_VOLUME = "box-player-volume";
const STORAGE_PROGRESS = "box-player-progress";

const $ = (id) => document.getElementById(id);

const ui = {
  player: $("player"),
  video: $("video"),
  audio: $("audio"),
  danmaku: $("danmaku"),
  bigPlay: $("bigPlay"),
  toast: $("toast"),
  loading: $("loading"),
  controls: $("controls"),
  playBtn: $("playBtn"),
  timeLabel: $("timeLabel"),
  muteBtn: $("muteBtn"),
  volume: $("volume"),
  danmakuToggle: $("danmakuToggle"),
  danmakuMenu: $("danmakuMenu"),
  opacity: $("opacity"),
  opacityVal: $("opacityVal"),
  areaRow: $("areaRow"),
  speedBtn: $("speedBtn"),
  speedMenu: $("speedMenu"),
  wideBtn: $("wideBtn"),
  fullBtn: $("fullBtn"),
  progressWrap: $("progressWrap"),
  playedBar: $("playedBar"),
  bufferBar: $("bufferBar"),
  progressThumb: $("progressThumb"),
  progressTip: $("progressTip"),
  heatmap: $("heatmap"),
  title: $("title"),
  subtitle: $("subtitle"),
  partList: $("partList"),
  partChips: $("partChips"),
  partCount: $("partCount"),
  search: $("search"),
};

const danmaku = new DanmakuEngine(ui.danmaku);
const progressMap = JSON.parse(localStorage.getItem(STORAGE_PROGRESS) || "{}");
let library = [];
let flatParts = [];
let current = null;
let hideTimer = 0;
let toastTimer = 0;
let rightTimer = 0;
let rightBoost = false;
let speedBeforeBoost = 1;
let dragging = false;

const media = new DualPlayer({
  video: ui.video,
  audio: ui.audio,
  onTime: updateProgress,
  onState: ({ playing, buffering, ended }) => {
    if (typeof playing === "boolean") setPlaying(playing);
    if (typeof buffering === "boolean") ui.loading.hidden = !buffering;
    if (ended) playNext();
  },
});

function showToast(text) {
  ui.toast.hidden = false;
  ui.toast.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    ui.toast.hidden = true;
  }, 900);
}

function setPlaying(playing) {
  ui.bigPlay.hidden = playing;
  ui.playBtn.querySelector(".icon-play").hidden = playing;
  ui.playBtn.querySelector(".icon-pause").hidden = !playing;
  ui.playBtn.setAttribute("aria-label", playing ? "暂停" : "播放");
  if (playing || ui.video.currentTime > 0.05) {
    ui.video.removeAttribute("poster");
  }
}

function durationOf(part, snapshot) {
  return snapshot?.duration || part?.durationMs / 1000 || 0;
}

function updateProgress(snapshot) {
  const duration = durationOf(current, snapshot);
  const time = snapshot.time || 0;
  const ratio = duration ? time / duration : 0;
  ui.playedBar.style.width = `${ratio * 100}%`;
  ui.progressThumb.style.left = `${ratio * 100}%`;
  ui.timeLabel.textContent = `${formatTime(time)} / ${formatTime(duration)}`;
  if (snapshot.buffered && duration) {
    let buffered = 0;
    for (let i = 0; i < snapshot.buffered.length; i += 1) {
      if (snapshot.buffered.start(i) <= time && snapshot.buffered.end(i) > buffered) {
        buffered = snapshot.buffered.end(i);
      }
    }
    ui.bufferBar.style.width = `${(buffered / duration) * 100}%`;
  }
  if (current) {
    progressMap[current.cid] = time;
    localStorage.setItem(STORAGE_PROGRESS, JSON.stringify(progressMap));
  }
}

function drawHeatmap(comments, duration) {
  const canvas = ui.heatmap;
  const ctx = canvas.getContext("2d");
  const width = canvas.clientWidth || 800;
  canvas.width = width;
  canvas.height = 8;
  ctx.clearRect(0, 0, width, 8);
  if (!comments.length || !duration) return;
  const buckets = Math.max(80, Math.floor(width / 4));
  const counts = new Array(buckets).fill(0);
  for (const comment of comments) {
    const i = Math.min(buckets - 1, Math.floor((comment.time / duration) * buckets));
    if (i >= 0) counts[i] += 1;
  }
  const max = Math.max(1, ...counts);
  counts.forEach((count, i) => {
    const a = count / max;
    ctx.fillStyle = `rgba(251, 114, 153, ${0.15 + a * 0.85})`;
    ctx.fillRect((i / buckets) * width, 0, width / buckets + 0.5, 8);
  });
}

function renderList(keyword = "") {
  const q = keyword.trim().toLowerCase();
  ui.partList.innerHTML = "";
  const shown = flatParts.filter((part) => {
    const hay = `${part.groupTitle} ${part.part}`.toLowerCase();
    return !q || hay.includes(q);
  });
  ui.partCount.textContent = `${shown.length} 集`;
  ui.partChips.innerHTML = "";
  for (const part of shown) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = `part-card${current?.cid === part.cid ? " active" : ""}`;
    btn.innerHTML = `
      <img class="part-thumb" src="${part.coverUrl}" alt="" />
      <span>
        <strong>P${part.page} ${part.part}</strong>
        <small>${part.quality} · ${formatTime(part.durationMs / 1000)} · ${part.danmakuCount} 弹幕</small>
      </span>
    `;
    btn.addEventListener("click", () => openPart(part, true));
    ui.partList.appendChild(btn);

    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = `part-chip${current?.cid === part.cid ? " active" : ""}`;
    chip.textContent = `P${part.page} ${part.part}`;
    chip.addEventListener("click", () => openPart(part, true));
    ui.partChips.appendChild(chip);
  }
}

function applySpeed(rate, persist = true) {
  media.setSpeed(rate);
  ui.speedBtn.textContent = rate === 1 ? "倍速" : `${rate}x`;
  ui.speedMenu.querySelectorAll("button").forEach((btn) => {
    btn.classList.toggle("on", Number(btn.dataset.speed) === rate);
  });
  if (persist) showToast(`${rate.toFixed(rate % 1 ? 2 : 1).replace(/\.00$/, ".0")}x`);
}

async function openPart(part, autoplay) {
  current = part;
  renderList(ui.search.value);
  ui.title.textContent = part.groupTitle;
  ui.subtitle.textContent = `${part.ownerName} · ${part.bvid} · P${part.page} ${part.part} · ${part.quality}`;
  ui.video.poster = part.coverUrl || "";
  ui.loading.hidden = false;
  ui.player.focus();
  danmaku.setComments([]);
  try {
    const [danmakuRes] = await Promise.all([
      fetch(part.danmakuUrl).then((r) => r.json()),
      media.load(part),
    ]);
    danmaku.setComments(danmakuRes.comments || []);
    drawHeatmap(danmakuRes.comments || [], durationOf(part, media.snapshot()));
    const saved = progressMap[part.cid] || 0;
    if (saved > 5 && saved < durationOf(part, media.snapshot()) - 5) {
      media.seek(saved);
      showToast(`续看 ${formatTime(saved)}`);
    }
    if (autoplay) await media.play();
  } catch (err) {
    console.error(err);
    showToast("无法打开这路缓存");
  } finally {
    ui.loading.hidden = true;
    danmaku.resize();
  }
}

function playNext() {
  if (!current) return;
  const index = flatParts.findIndex((part) => part.cid === current.cid);
  const next = flatParts[index + 1];
  if (next) openPart(next, true);
}

function seekFromEvent(event) {
  const rect = ui.progressWrap.getBoundingClientRect();
  const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
  media.seek(ratio * durationOf(current, media.snapshot()));
}

function loop(now) {
  danmaku.tick(media.snapshot().time, !media.paused);
  requestAnimationFrame(loop);
  if (now) return;
}

function bindPlayerChrome() {
  ui.bigPlay.addEventListener("click", () => media.toggle());
  ui.playBtn.addEventListener("click", () => media.toggle());
  ui.player.addEventListener("click", (event) => {
    if (event.target.closest(".controls, .big-play, .popover")) return;
    media.toggle();
  });
  ui.player.addEventListener("dblclick", (event) => {
    if (event.target.closest(".controls")) return;
    toggleFullscreen();
  });

  ui.muteBtn.addEventListener("click", () => {
    const muted = media.toggleMute();
    ui.volume.value = muted ? 0 : String(Math.round(media.volume * 100));
    showToast(muted ? "静音" : `${ui.volume.value}%`);
  });
  ui.volume.addEventListener("input", () => {
    media.setVolume(Number(ui.volume.value) / 100);
    persistVolume();
  });

  ui.danmakuToggle.addEventListener("click", () => {
    danmaku.enabled = !danmaku.enabled;
    ui.danmakuToggle.classList.toggle("on", danmaku.enabled);
    showToast(danmaku.enabled ? "弹幕开" : "弹幕关");
  });
  ui.danmakuToggle.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    ui.danmakuMenu.hidden = !ui.danmakuMenu.hidden;
    ui.speedMenu.hidden = true;
  });
  ui.opacity.addEventListener("input", () => {
    danmaku.opacity = Number(ui.opacity.value) / 100;
    ui.opacityVal.textContent = `${ui.opacity.value}%`;
  });
  ui.areaRow.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    danmaku.area = Number(btn.dataset.area);
    ui.areaRow.querySelectorAll("button").forEach((node) => node.classList.toggle("on", node === btn));
  });

  ui.speedBtn.addEventListener("click", () => {
    ui.speedMenu.hidden = !ui.speedMenu.hidden;
    ui.danmakuMenu.hidden = true;
  });
  ui.speedMenu.addEventListener("click", (event) => {
    const btn = event.target.closest("button");
    if (!btn) return;
    applySpeed(Number(btn.dataset.speed));
    ui.speedMenu.hidden = true;
  });

  ui.wideBtn.addEventListener("click", () => {
    ui.player.classList.toggle("web-full");
    danmaku.resize();
  });
  ui.fullBtn.addEventListener("click", toggleFullscreen);

  ui.progressWrap.addEventListener("mousedown", (event) => {
    dragging = true;
    seekFromEvent(event);
  });
  window.addEventListener("mouseup", () => {
    dragging = false;
  });
  window.addEventListener("mousemove", (event) => {
    if (dragging) seekFromEvent(event);
    const rect = ui.progressWrap.getBoundingClientRect();
    const inside = event.clientY >= rect.top - 8 && event.clientY <= rect.bottom + 8;
    if (!inside) {
      ui.progressTip.hidden = true;
      return;
    }
    const ratio = Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width));
    ui.progressTip.hidden = false;
    ui.progressTip.style.left = `${ratio * 100}%`;
    ui.progressTip.textContent = formatTime(ratio * durationOf(current, media.snapshot()));
  });

  ui.player.addEventListener("mousemove", () => {
    ui.player.classList.add("show-controls");
    clearTimeout(hideTimer);
    hideTimer = setTimeout(() => ui.player.classList.remove("show-controls"), 2000);
  });
  ui.player.addEventListener("wheel", (event) => {
    event.preventDefault();
    bumpVolume(event.deltaY < 0 ? 0.05 : -0.05);
  }, { passive: false });

  document.addEventListener("click", (event) => {
    if (!event.target.closest(".menu-wrap")) {
      ui.speedMenu.hidden = true;
      ui.danmakuMenu.hidden = true;
    }
  });

  window.addEventListener("resize", () => {
    danmaku.resize();
    if (current) drawHeatmap(danmaku.comments, durationOf(current, media.snapshot()));
  });
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else ui.player.requestFullscreen();
}

function isTyping(event) {
  const el = event.target;
  return el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement;
}

function bindKeys() {
  document.addEventListener("keydown", (event) => {
    if (isTyping(event)) return;
    if (event.code === "Space") {
      event.preventDefault();
      media.toggle();
      return;
    }
    if (event.code === "ArrowRight") {
      event.preventDefault();
      if (event.repeat) return;
      rightTimer = setTimeout(() => {
        rightBoost = true;
        speedBeforeBoost = media.speed;
        applySpeed(2, false);
        showToast("2.0x");
      }, 180);
      return;
    }
    if (event.code === "ArrowLeft") {
      event.preventDefault();
      media.seek(media.snapshot().time - 5);
      showToast("-5s");
      return;
    }
    if (event.code === "ArrowUp") {
      event.preventDefault();
      bumpVolume(0.1);
      return;
    }
    if (event.code === "ArrowDown") {
      event.preventDefault();
      bumpVolume(-0.1);
      return;
    }
    if (event.code === "KeyF") {
      toggleFullscreen();
      return;
    }
    if (event.code === "KeyM") {
      const muted = media.toggleMute();
      ui.volume.value = muted ? 0 : String(Math.round(media.volume * 100));
      showToast(muted ? "静音" : "取消静音");
      return;
    }
    if (event.code === "Escape" && ui.player.classList.contains("web-full")) {
      ui.player.classList.remove("web-full");
      danmaku.resize();
      return;
    }
    if (event.code === "KeyD") {
      danmaku.enabled = !danmaku.enabled;
      ui.danmakuToggle.classList.toggle("on", danmaku.enabled);
      showToast(danmaku.enabled ? "弹幕开" : "弹幕关");
      return;
    }
    if (event.key >= "0" && event.key <= "9") {
      const duration = durationOf(current, media.snapshot());
      media.seek((Number(event.key) / 10) * duration);
    }
  });

  document.addEventListener("keyup", (event) => {
    if (event.code !== "ArrowRight") return;
    clearTimeout(rightTimer);
    if (rightBoost) {
      applySpeed(speedBeforeBoost, false);
      rightBoost = false;
      showToast(`${speedBeforeBoost}x`);
    } else if (!isTyping(event)) {
      media.seek(media.snapshot().time + 5);
      showToast("+5s");
    }
  });
  window.addEventListener("blur", () => {
    clearTimeout(rightTimer);
    if (rightBoost) {
      applySpeed(speedBeforeBoost, false);
      rightBoost = false;
    }
  });
}

function persistVolume() {
  localStorage.setItem(STORAGE_VOLUME, String(media.volume));
}

function bumpVolume(delta) {
  media.setVolume(media.volume + delta);
  ui.volume.value = String(Math.round(media.volume * 100));
  persistVolume();
  showToast(`${ui.volume.value}%`);
}

async function boot() {
  const rawVolume = localStorage.getItem(STORAGE_VOLUME);
  const savedVolume = rawVolume === null ? NaN : Number(rawVolume);
  if (Number.isFinite(savedVolume)) {
    media.setVolume(savedVolume);
    ui.volume.value = String(Math.round(savedVolume * 100));
  } else {
    media.setVolume(0.8);
    ui.volume.value = "80";
  }
  ui.danmakuToggle.classList.add("on");

  bindPlayerChrome();
  bindKeys();
  requestAnimationFrame(loop);
  ui.search.addEventListener("input", () => renderList(ui.search.value));

  const hevc = ui.video.canPlayType('video/mp4; codecs="hvc1.1.6.L120.90"');
  if (!hevc) {
    ui.subtitle.textContent =
      "当前浏览器可能无法解码 HEVC，建议使用 Edge / Chrome 并安装 HEVC 视频扩展";
  }

  const data = await fetch("/api/library").then((r) => r.json());
  library = data.groups || [];
  flatParts = library.flatMap((group) =>
    group.parts.map((part) => ({
      ...part,
      groupTitle: group.title,
      ownerName: group.ownerName,
      bvid: group.bvid,
    })),
  );
  renderList();
  if (flatParts[0]) {
    await openPart(flatParts[0], false);
  }
}

boot().catch((err) => {
  console.error(err);
  ui.subtitle.textContent = "读取缓存目录失败，请确认已运行 node server.js";
});
