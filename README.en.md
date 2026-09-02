# 📦 Ozon Stats — Order Statistics

[🇷🇺 Русский](README.md) · 🇬🇧 English

![version](https://img.shields.io/badge/version-1.0.0-blue)
![Chrome](https://img.shields.io/badge/Chrome-MV3-4285F4?logo=googlechrome&logoColor=white)
![Brave](https://img.shields.io/badge/Brave-supported-FB542B?logo=brave&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

A **Chrome/Brave** extension that adds a full-height side panel to Ozon.ru with order
statistics: total money spent, order count, registration date, per-year breakdown, a
chart, and a list of active orders (with photos, statuses, delivery dates, pickup-point
addresses, and "ready for pickup first" sorting).

## 🧬 Origin

This project is based on **[Ozon Stats — Статистика
заказов](https://chromewebstore.google.com/detail/dpiekoogdgfdnamkekndojoplgomelkm)**
by **luckydawnbastard** (`pbgboroda@gmail.com`), published on the Chrome Web Store. The
original was unpacked from the installed extension and used as the starting point for
further work — this is a fork/modification of the original code, not an independent
from-scratch implementation.

On top of the base feature set (spend total, order count, registration date, per-year
breakdown, chart, priority sorting of active orders) this version adds:
- 📸 photos and statuses of active orders, delivery date;
- 📍 pickup-point/locker address, click-to-copy order number;
- 🔗 click an order card to open it on Ozon;
- 🔢 badge on the extension icon with the active order count;
- 🔔 notifications on order status changes;
- ⚡ cached data for an instant panel render on page load.

All rights to the original idea and name belong to the original author. If you have
concerns about similarity or attribution, please open an issue.

The [MIT](LICENSE) license in this repository covers the code written for this
project. The original extension's license is unknown — its source is not available.

## 🚀 Install

### From a release

1. Download `ozon-stats.zip` from [Releases](../../releases) and unpack it.
2. `chrome://extensions` (`brave://extensions` on Brave) → enable "Developer mode".
3. "Load unpacked" → select the unpacked folder.

### From source (dev)

1. Clone the repo.
2. `chrome://extensions` (`brave://extensions` on Brave) → enable "Developer mode" →
   "Load unpacked" → select this folder.
3. Open `ozon.ru` — a full-height panel appears on the right.

## 🛠 Releases

Versioning is independent of the original (this isn't a 1:1 fork, it's a deep
rework) — restarted at `1.0.0`.

Releases are built automatically ([GitHub Actions](.github/workflows/release.yml)):
pushing a `vX.Y.Z` tag (must match `manifest.json`) builds `ozon-stats.zip` and
publishes it as a GitHub Release.
