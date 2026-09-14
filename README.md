# BiliPlayer

读取 `videos` 目录里的 B 站手机客户端离线缓存（分离的 `video.m4s` + `audio.m4s` + `danmaku.xml`），在浏览器里列出分集、同步播放音视频，并按弹幕时间轴渲染弹幕。

把缓存目录放到 `videos/` 下即可，仓库里只保留空目录，不会提交视频文件。

## 启动

双击项目根目录的 `start.bat`，会启动服务并自动打开浏览器。

```bash
npm start
```

或只开服务、不自动打开浏览器：

```bash
node server.js
```

默认地址 http://127.0.0.1:3456

缓存视频是 HEVC（`hvc1`）。Windows 上请用 Edge 或已安装 [HEVC 视频扩展](https://apps.microsoft.com/detail/9nmzlz57r3t7) 的 Chrome。

## 快捷键

| 按键 | 行为 |
| --- | --- |
| 空格 | 播放 / 暂停 |
| ← / 点按 → | 退 / 进 5 秒 |
| 按住 → | 临时 2 倍速，松开恢复 |
| ↑ / ↓ | 音量加减 |
| 滚轮（播放器上） | 音量 |
| 0–9 | 跳到 0%–90% |
| F | 全屏 |
| M | 静音 |
| D | 开关弹幕 |

## 缓存目录约定

```
videos/c_<cid>/
  entry.json
  cover.jpg
  danmaku.xml
  <清晰度>/
    video.m4s
    audio.m4s
    index.json
```
