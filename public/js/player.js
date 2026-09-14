function pad(n) {
  return String(Math.floor(n)).padStart(2, "0");
}

export function formatTime(seconds) {
  if (!Number.isFinite(seconds) || seconds < 0) seconds = 0;
  const s = Math.floor(seconds % 60);
  const m = Math.floor(seconds / 60) % 60;
  const h = Math.floor(seconds / 3600);
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function wait(el, event) {
  return new Promise((resolve, reject) => {
    const ok = () => {
      el.removeEventListener("error", bad);
      resolve();
    };
    const bad = () => {
      el.removeEventListener(event, ok);
      reject(new Error("media error"));
    };
    el.addEventListener(event, ok, { once: true });
    el.addEventListener("error", bad, { once: true });
  });
}

export class DualPlayer {
  constructor({ video, audio, onTime, onState }) {
    this.video = video;
    this.audio = audio;
    this.onTime = onTime;
    this.onState = onState;
    this.speed = 1;
    this.volume = 0.8;
    this.seeking = false;
    this._bind();
  }

  _bind() {
    this.video.addEventListener("timeupdate", () => this._sync("video"));
    this.audio.addEventListener("timeupdate", () => this._sync("audio"));
    this.video.addEventListener("waiting", () => {
      this.audio.pause();
      this.onState?.({ buffering: true });
    });
    this.video.addEventListener("playing", () => {
      this._alignAudio();
      this.audio.play().catch(() => {});
      this.onState?.({ buffering: false, playing: true });
    });
    this.video.addEventListener("pause", () => {
      this.audio.pause();
      this.onState?.({ playing: false });
    });
    this.video.addEventListener("ended", () => this.onState?.({ ended: true }));
    this.video.addEventListener("progress", () => this.onTime?.(this.snapshot()));
  }

  snapshot() {
    return {
      time: this.video.currentTime || 0,
      duration: this.duration,
      paused: this.video.paused,
      buffered: this.video.buffered,
    };
  }

  get duration() {
    const d = this.video.duration;
    return Number.isFinite(d) && d > 0 ? d : this._durationHint || 0;
  }

  get paused() {
    return this.video.paused;
  }

  async load({ videoUrl, audioUrl, durationMs = 0 }) {
    this._durationHint = durationMs / 1000;
    this.video.muted = true;
    this.audio.volume = this.volume;
    this.video.playbackRate = this.speed;
    this.audio.playbackRate = this.speed;
    this.video.src = videoUrl;
    this.audio.src = audioUrl;
    this.video.load();
    this.audio.load();
    await Promise.all([wait(this.video, "loadedmetadata"), wait(this.audio, "loadedmetadata")]);
    this.onTime?.(this.snapshot());
  }

  async play() {
    this._alignAudio();
    await Promise.all([this.video.play(), this.audio.play()]);
  }

  pause() {
    this.video.pause();
    this.audio.pause();
  }

  toggle() {
    return this.paused ? this.play() : this.pause();
  }

  seek(time) {
    const next = Math.max(0, Math.min(this.duration || time, time));
    this.seeking = true;
    this.video.currentTime = next;
    this.audio.currentTime = next;
    this.seeking = false;
    this.onTime?.(this.snapshot());
  }

  setSpeed(rate) {
    this.speed = rate;
    this.video.playbackRate = rate;
    this.audio.playbackRate = rate;
  }

  setVolume(vol) {
    this.volume = Math.max(0, Math.min(1, vol));
    this.audio.muted = this.volume === 0;
    this.audio.volume = this.volume;
  }

  toggleMute() {
    if (this.audio.muted || this.volume === 0) {
      this.setVolume(this.volume || 0.8);
      this.audio.muted = false;
    } else {
      this.audio.muted = true;
    }
    return this.audio.muted;
  }

  _alignAudio() {
    if (Math.abs((this.audio.currentTime || 0) - (this.video.currentTime || 0)) > 0.05) {
      this.audio.currentTime = this.video.currentTime || 0;
    }
  }

  _sync(source) {
    if (this.seeking) return;
    const drift = (this.video.currentTime || 0) - (this.audio.currentTime || 0);
    if (Math.abs(drift) > 0.12) {
      if (source === "video") this.audio.currentTime = this.video.currentTime;
      else this.video.currentTime = this.audio.currentTime;
    }
    this.onTime?.(this.snapshot());
  }
}
