function colorCss(n) {
  return `#${(n >>> 0).toString(16).padStart(6, "0")}`;
}

export class DanmakuEngine {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.comments = [];
    this.active = [];
    this.cursor = 0;
    this.enabled = true;
    this.opacity = 0.8;
    this.area = 1;
    this.lastTime = 0;
    this.lastWall = 0;
    this.resize();
  }

  setComments(comments) {
    this.comments = comments.slice().sort((a, b) => a.time - b.time);
    this.reset(0);
  }

  resize() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.width = Math.max(1, Math.floor(rect.width));
    this.height = Math.max(1, Math.floor(rect.height));
    this.canvas.width = this.width * dpr;
    this.canvas.height = this.height * dpr;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  reset(time) {
    this.active = [];
    this.lastTime = time;
    const lookback = 8;
    let i = 0;
    while (i < this.comments.length && this.comments[i].time < time - lookback) i += 1;
    this.cursor = i;
    while (this.cursor < this.comments.length && this.comments[this.cursor].time <= time) {
      this.spawn(this.comments[this.cursor], time);
      this.cursor += 1;
    }
  }

  fontSize(comment) {
    return Math.max(16, Math.round((this.height / 28) * (comment.size / 25)));
  }

  spawn(comment, time) {
    if (!this.enabled) return;
    const mode = comment.mode;
    if (mode === 7 || mode === 8) return;
    const size = this.fontSize(comment);
    this.ctx.font = `600 ${size}px "Noto Sans SC", "IBM Plex Sans", sans-serif`;
    const width = Math.ceil(this.ctx.measureText(comment.text).width);
    const usable = this.height * this.area;
    const rowH = size + 8;
    const rows = Math.max(1, Math.floor(usable / rowH));
    const kind = mode === 4 ? "bottom" : mode === 5 ? "top" : "scroll";
    let row = 0;
    for (let r = 0; r < rows; r += 1) {
      const busy = this.active.some((item) => {
        if (item.kind !== kind || item.row !== r) return false;
        if (kind !== "scroll") return time - item.born < 4.2;
        return item.x + item.width > this.width - 48;
      });
      if (!busy) {
        row = r;
        break;
      }
      row = r;
    }
    const y =
      kind === "bottom"
        ? this.height - (row + 1) * rowH - 12
        : 10 + row * rowH;
    let x = kind === "scroll" ? this.width : Math.max(12, (this.width - width) / 2);
    if (kind === "scroll") {
      const progress = Math.max(0, Math.min(1, (time - comment.time) / 8));
      const from = mode === 6 ? -width : this.width;
      const to = mode === 6 ? this.width : -width;
      x = from + (to - from) * progress;
    }
    this.active.push({
      ...comment,
      kind,
      width,
      size,
      row,
      x,
      y,
      born: comment.time,
      reverse: mode === 6,
    });
  }

  tick(time, playing) {
    const now = performance.now();
    const dt = this.lastWall ? Math.min(0.05, (now - this.lastWall) / 1000) : 0.016;
    this.lastWall = now;
    if (Math.abs(time - this.lastTime) > 1.2) this.reset(time);
    if (playing) {
      while (this.cursor < this.comments.length && this.comments[this.cursor].time <= time) {
        this.spawn(this.comments[this.cursor], time);
        this.cursor += 1;
      }
    }
    this.lastTime = time;
    const speed = this.width / 8;
    this.active = this.active.filter((item) => {
      if (item.kind === "scroll") {
        const dir = item.reverse ? 1 : -1;
        if (playing) item.x += dir * speed * dt;
        return item.reverse ? item.x < this.width + item.width : item.x + item.width > -20;
      }
      return time - item.born < 4.5;
    });
    this.draw();
  }

  draw() {
    const { ctx, width, height } = this;
    ctx.clearRect(0, 0, width, height);
    if (!this.enabled) return;
    ctx.globalAlpha = this.opacity;
    ctx.lineWidth = 3;
    ctx.lineJoin = "round";
    for (const item of this.active) {
      ctx.font = `600 ${item.size}px "Noto Sans SC", "IBM Plex Sans", sans-serif`;
      ctx.strokeStyle = "rgba(0,0,0,0.7)";
      ctx.fillStyle = colorCss(item.color);
      ctx.strokeText(item.text, item.x, item.y + item.size);
      ctx.fillText(item.text, item.x, item.y + item.size);
    }
    ctx.globalAlpha = 1;
  }
}
