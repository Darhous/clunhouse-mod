<div align="center">

<img src="public/banner.svg" alt="Clubhouse mod by Darhous" width="100%" />

<br/>

[![License: MIT + Attribution](https://img.shields.io/badge/license-MIT%20%2B%20Attribution-6366F1?style=flat-square)](LICENSE.md)
[![Cost](https://img.shields.io/badge/cost-free-6366F1?style=flat-square)](#license--fair-use)
[![Made in Egypt](https://img.shields.io/badge/made%20with-%E2%9D%A4%EF%B8%8F%20in%20Egypt-6366F1?style=flat-square)](https://github.com/darhous)

[![Node.js](https://img.shields.io/badge/Node.js-339933?style=flat-square&logo=node.js&logoColor=white)](https://nodejs.org)
[![JavaScript](https://img.shields.io/badge/JavaScript-F7DF1E?style=flat-square&logo=javascript&logoColor=black)](public/app.js)
[![HTML5](https://img.shields.io/badge/HTML5-E34F26?style=flat-square&logo=html5&logoColor=white)](public/index.html)
[![CSS3](https://img.shields.io/badge/CSS3-1572B6?style=flat-square&logo=css3&logoColor=white)](public/style.css)

[🇬🇧 English](README.md) · [🇪🇬 العربية](README.ar.md)

</div>

---

**Moderating a live Clubhouse room from your phone is a losing battle.** The queue moves faster than you can tap, you can't see the room at a glance, and one wrong tap has no undo.

I built **Clubhouse mod by Darhous** to fix exactly that. Every screen, every safeguard, every deliberate delay that keeps Clubhouse's spam filter from kicking in — all of it came from actually running rooms with this, not from a spec sheet. It's free, it's built with real care, and I hope it saves you the same headaches it saved me.

## Contents

- [Quick start](#quick-start)
- [How it signs in](#how-it-signs-in)
- [Architecture at a glance](#architecture-at-a-glance)
- [Features](#features)
- [Settings & configuration](#settings--configuration)
- [Documentation](#documentation)
- [How it's built](#how-its-built)
- [Safety by design](#safety-by-design)
- [FAQ](#faq)
- [Known limits](#known-limits)
- [License & fair use](#license--fair-use)

## Quick start

**New to running things from a terminal? No problem — follow these in order.**

**1. Open a terminal**

- **Start menu:** click Start, type `PowerShell` (or `Command Prompt`), and click it when it appears.
- **Or the fast way:** press `Win + R`, type `cmd`, and press Enter.

Either one opens a black/blue window where you can type commands — that's your terminal.

**2. Check whether you already have Node.js**

In that terminal, type:

```bash
node --version
```

- See something like `v18.x.x` or higher? Good, you're set — skip to step 3.
- See "not recognized" / "command not found"? Go to **[nodejs.org](https://nodejs.org)**, download the **LTS** version, and run the installer (the defaults are fine — just click Next through it). Close and reopen your terminal, then try `node --version` again to confirm.

**3. Get the code and run it**

```bash
git clone https://github.com/Darhous/clunhouse-mod.git
cd clunhouse-mod
npm install
npm start
```

> No `git` installed? Click the green **Code** button at the top of this page → **Download ZIP** → extract it → open a terminal inside the extracted folder and continue from `npm install`.

Then open **http://localhost:4545** in your browser. That's the whole install — no database, no external services, no build step.

> Once it's installed, Windows users can skip the terminal entirely next time: just double-click **`تشغيل.bat`** to start the server and open the browser automatically.

It works out of the box in any of these three ways — pick whichever fits you:

| Mode | What you need | Where it's set up |
|---|---|---|
| **Clubdeck companion** *(zero setup)* | [Clubdeck](https://www.clubdeck.app/) installed and logged in on the same machine | Automatic — see [How it signs in](#how-it-signs-in) |
| **Auth token + user ID** | Your own Clubhouse auth token and numeric user ID | *Accounts* tab → *Sign in with token* |
| **Phone number** | Your Clubhouse-registered phone number | *Accounts* tab → *Sign in with phone* (OTP), no Clubdeck required |

You can hold several of these signed in at once and switch between them from the *Accounts* tab — say, your own Clubdeck session for daily use, plus a token-based account for a client's room.

## How it signs in

By default, the server looks for **Clubdeck's own local session file** and reads whichever Clubhouse account is currently logged into it — the same way Clubdeck's own device sees you. It resolves automatically to:

```
%LOCALAPPDATA%\Programs\Clubdeck\profile.json
```

`%LOCALAPPDATA%` always points at *your* Windows user folder, so this works unmodified for anyone who clones the repo — nobody's personal file path is hardcoded here. Nothing is copied, cached, or sent anywhere: it's read live, straight off disk, on your own machine, every time the app needs it.

If you'd rather not depend on Clubdeck at all, use the token or phone sign-in above instead — Clubdeck doesn't need to be installed for either of those. Whichever way you sign in, your credentials never leave your machine: there's no backend, no analytics, no telemetry. The server *is* your machine.

## Architecture at a glance

```
┌────────────────┐   HTTP + Server-Sent Events   ┌──────────────────┐   private API   ┌───────────────┐
│  Your browser  │ ◄────────────────────────────► │   Node server     │ ◄──────────────► │   Clubhouse   │
│  (public/*)    │        localhost:4545          │   (server.js)     │  clubhouseapi.com │   (the room)  │
└────────────────┘                                 └─────────┬────────┘                  └───────────────┘
                                                              │
                                                              ▼
                                                    ┌───────────────────┐
                                                    │   local data/*.json │
                                                    │  settings · audit  │
                                                    │  archive · lists   │
                                                    │   (yours, never    │
                                                    │    committed)      │
                                                    └───────────────────┘
```

One process, one machine, one direction of trust: your browser only ever talks to your own server, and your server only ever talks to Clubhouse directly. Nothing in between.

## Features

The app is organized into workspace tabs, grouped here the same way they're grouped in the sidebar.

### Live room operations

What you're looking at while a room is actually running.

| Feature | What it does | Powered by |
|---|---|---|
| Live room dashboard | Real-time roster, roles, and room state, refreshed automatically without a page reload | `get_channel` polling + Server-Sent Events |
| Quick control | The handful of commands you reach for constantly, one click away, with dangerous ones visually separated from routine ones | `mute_speaker`, `invite_speaker`, `uninvite_speaker` |
| Speaking queue | See who raised a hand and when, invite one / next-N / everyone, and a standing backup of the queue in case it clears unexpectedly | `get_handraise_queue`, `invite_speaker` |
| Stage & audience | Full roster with per-member actions — mute, invite, lower, kick, promote/demote moderator — single-click or bulk | `mute_speaker`, `block_from_channel`, `make_moderator` |
| In-room search | Find anyone currently in the room by name or ID in a large room, instantly | Client-side filter over the live roster |
| Room chat | Read and post to the room's text chat, like/unlike, moderator delete, and automatic per-role welcome messages (listeners, speakers, and moderators each get their own on/off switch) | `get_channel_messages`, `send_channel_message`, `like_channel_message` |
| Reactions & effects | Single reactions, 3-reaction combos, room-wide bursts, and GIFs pulled from Clubhouse's own real catalogs — not a generic emoji picker | `emoji_reaction`, `gif_reaction` |

### Automation & protection

Rules that run themselves so you don't have to babysit the room.

| Feature | What it does |
|---|---|
| VIP auto-invite | Anyone on your VIP list gets invited to speak the moment they show up as a listener |
| Blacklist auto-moderation | Automatic mute/removal for blacklisted names, with optional auto-expiry after N days |
| Mic-hog cooldown | Speakers who've had their turn get a cooldown before they can be invited back up |
| Speaking time limits | Auto-lower anyone who's been speaking longer than your configured limit |
| Quiet hours | Automatically lock hand-raising during hours you set, every day |
| Turn rotation | Automatically rotate the newest raised hand into the longest-standing speaker's seat |
| Room capacity guard | Alert (and optionally auto-fill) when the room approaches a size you define |
| Ghost-mic detection | Flags speakers who've gone silent for an unusually long time |

Every one of these has its own independent on/off switch — see [Settings & configuration](#settings--configuration) below.

### Discovery & social

Everything outside the one room you're currently watching.

| Feature | What it does | Powered by |
|---|---|---|
| Live rooms feed | Browse every public room happening now, join or watch read-only | `get_feed_v3` |
| Houses | Manage your Houses, their members and admins, and past replays | `get_social_club_members`, `get_replays` |
| Direct messages | Read chats, accept or hide requests, bulk-accept everything pending | `get_chats`, `accept_dm_conversation_request` |
| Social graph | Search anyone, follow/unfollow/block, see mutual followers | `search_users`, `get_followers` |
| Friends & notifications | A background watcher that tells you the moment a followed friend joins a room | `lib/friendsWatcher.js` |
| Profile | Review and edit your own Clubhouse identity (name, username, bio) from one screen | `get_profile`, `update_bio` |

### Platform, accounts & safety net

The parts that make this feel like a real product instead of a script.

| Feature | What it does | Powered by |
|---|---|---|
| Multi-account switching | Jump between Clubdeck's session and any number of manually signed-in accounts | `lib/account.js` |
| Safe bulk operations | Every bulk action goes preview → optional dry-run → execute, with live progress and one-click cancel — nothing fires blind | `lib/operationManager.js` |
| Session archive | Every past monitored room is saved locally and browsable afterward | `lib/state.js` |
| Audit log | Every action you've taken, searchable, with a per-person history view | `/api/audit-log`, `/api/user-history/:id` |
| Live API log | Every request/response to Clubhouse, timestamped and exportable — for when you need to know exactly what happened | `lib/logBuffer.js` |
| Self-diagnostics | One screen showing server, account, room, and API-contract health, computed entirely locally | `/api/platform/diagnostics` |
| Read-only mode | A single switch that turns every write action into a hard no-op — for when you want to just watch | `serverReadOnlyMode` setting |

This is the highlights reel, organized by where you'd find each thing in the app. The full route-by-route reference — every one of the ~90 local endpoints and every Clubhouse call behind them — is in [`docs/`](docs/).

## Settings & configuration

Every automation rule listed above has its own independent on/off switch in the *Settings* tab, grouped by category — nothing is bundled into a single all-or-nothing "automation mode," and nothing runs unless you explicitly turn it on. A few worth calling out specifically:

- **Read-only mode** — one master switch that turns every write action into a hard no-op. Flip it on when you want to just watch a room with zero risk of an accidental click doing something real.
- **Desktop notifications** — a lone-moderator alert, room-capacity alert, ghost-mic alert, blacklist-join alert, and new-speaker alert each have their own toggle, so you only get pinged for what you actually care about.
- **Welcome messages** — three independent toggles (listeners / speakers / moderators), each with its own custom message template using a `{name}` placeholder.

### Animated GIFs *(optional)*

GIF search and sending is powered by **[Giphy](https://giphy.com)** — the same free service most apps use for GIF search. It's entirely optional: everything else in this app works with zero configuration.

To turn it on:

1. Go to **[developers.giphy.com](https://developers.giphy.com/)**, create a free account, and create an app to get an **API key** — no cost, no credit card required.
2. Paste that key into the *Settings* tab under **Giphy API key**.
3. GIF search starts working immediately, no restart needed.

Don't care about GIFs? Skip this entirely — every other feature works without it.

## Documentation

Two reference documents live in [`docs/`](docs/), written straight from the source code rather than from memory — every request/response shape in them was checked against what the code actually sends and receives:

| Document | What's inside |
|---|---|
| [`CLUBHOUSE_API_ENDPOINTS.md`](docs/CLUBHOUSE_API_ENDPOINTS.md) | Every Clubhouse endpoint the app talks to: base URL, auth headers, the "modern client" fingerprint some room actions need, rate-limit behavior, and a full table of every endpoint with its verification status (live-confirmed vs. best-guess vs. known-dead). |
| [`INTERNAL_SERVER_API.md`](docs/INTERNAL_SERVER_API.md) | Every local route this app exposes on `localhost:4545`, how the real-time event stream works, and a deep dive into the room-chat subsystem specifically (context tokens, polling cadence, dedup) for anyone who wants to build something on top of it — a Telegram bridge, a bot, whatever. |

Both are written in Arabic, matching the app's own UI language — but every endpoint name, path, and code sample in them is exactly as it appears in the source, so they're just as usable as a technical reference either way.

## How it's built

Plain Node.js (`http` module, no framework) talking directly to Clubhouse's private API — the same one Clubdeck itself uses, reverse-engineered by observation rather than official docs, since Clubhouse doesn't publish one. A 3-second poll loop (`lib/poller.js`) watches the room and pushes updates to the browser over Server-Sent Events — no WebSocket, no external dependency, nothing to configure. The whole frontend is hand-written HTML/CSS/JS — no framework, no bundler, no build step between editing a file and reloading the page.

## Safety by design

Clubhouse silently rate-limits reactions and messages if you send them too fast — I found this out the hard way, more than once. Every bulk action shares a persistent, per-account rate limiter (`lib/featureLimiter.js`) that backs off automatically on a real rejection instead of hammering it further, and every destructive action (kick, end room, delete message) goes through an explicit confirmation dialog naming exactly what it will do before it does it.

## FAQ

**Will Clubhouse ban my account for using this?**
It talks to the same private API Clubdeck itself uses, at deliberately human-paced rates — the built-in rate limiter exists specifically because I hit that wall myself and don't want you to. That said, it's still an unofficial client, same as Clubdeck: use it the way you'd use any moderation tool, not to spam or abuse the platform.

**Do I need Clubdeck installed to use this?**
No. Clubdeck is one of three sign-in options, not a requirement — token or phone sign-in work with zero Clubdeck involvement.

**Does it work on Mac or Linux?**
The server itself is plain Node.js and runs anywhere. The *Clubdeck companion* auto-detection path is Windows-specific (it reads Clubdeck's own Windows install path); token and phone sign-in work on any OS.

**Is any of my data sent anywhere?**
No. There's no backend server of mine, no analytics, no telemetry. Everything — your session, your settings, your archive — stays in a local `data/` folder on your own machine.

**Can I run this next to Clubdeck at the same time?**
Yes — that's exactly what companion mode is for.

## Known limits

A few Clubhouse endpoints are documented as broken, unconfirmed, or deliberately unsupported — see the "status" column in [`CLUBHOUSE_API_ENDPOINTS.md`](docs/CLUBHOUSE_API_ENDPOINTS.md) for the full, honest list rather than a marketing one. The short version: email/password sign-in isn't possible (Clubhouse has no such API), and a couple of legacy endpoints Clubhouse itself has retired are kept in the registry only as a record of what *used* to work.

## License & fair use

Free to use, study, modify, and redistribute under **MIT plus a short attribution addendum** — see [`LICENSE.md`](LICENSE.md) for the exact terms. In plain language: use it however helps you, including to moderate rooms commercially, just don't strip the credit.

Specifically — **please don't remove or edit the credit footer** ("Designed & Developed by Ahmed Darhous" and its links) in any copy or fork of this app. It costs you nothing to leave it, and it's the one thing I'm asking for in exchange for giving this away for free.

---

<div align="center" dir="ltr">

**Designed & Developed by Ahmed Darhous**
+20 103 000 2331 · ahmeddarhous@gmail.com

[![Instagram](https://img.shields.io/badge/Instagram-E4405F?style=for-the-badge&logo=instagram&logoColor=white)](https://www.instagram.com/darhous/)
[![LinkedIn](https://img.shields.io/badge/LinkedIn-0A66C2?style=for-the-badge&logo=linkedin&logoColor=white)](https://www.linkedin.com/in/darhous/)
[![Facebook](https://img.shields.io/badge/Facebook-1877F2?style=for-the-badge&logo=facebook&logoColor=white)](https://www.facebook.com/ahmed.darhous)
[![WhatsApp](https://img.shields.io/badge/WhatsApp-25D366?style=for-the-badge&logo=whatsapp&logoColor=white)](https://wa.me/201030002331)
[![GitHub](https://img.shields.io/badge/GitHub-181717?style=for-the-badge&logo=github&logoColor=white)](https://github.com/darhous)
[![Portfolio](https://img.shields.io/badge/Portfolio-6366F1?style=for-the-badge&logo=googlechrome&logoColor=white)](https://darhous.github.io/portofolio/)

</div>
