<div align="center">

<img src="public/favicon.svg" width="88" height="88" alt="Clubhouse mod by Darhous logo" />

# Clubhouse mod by Darhous

**A real-time moderator control surface for Clubhouse rooms — self-hosted, no cloud, no middleman.**

[![License: MIT + Attribution](https://img.shields.io/badge/license-MIT%20%2B%20Attribution-6366F1)](LICENSE.md)
[![Node](https://img.shields.io/badge/node-%E2%89%A518-22D3EE)](https://nodejs.org)
[![Made with](https://img.shields.io/badge/made%20with-%E2%9D%A4%EF%B8%8F%20in%20Egypt-6366F1)](https://github.com/darhous)

[🇬🇧 English](README.md) · [🇪🇬 العربية](README.ar.md)

</div>

---

I built this for one reason: moderating a live Clubhouse room from the phone app alone is genuinely hard — the queue moves faster than you can tap, you can't see who's who at a glance, and there's no undo. This is the tool I wished existed. Every screen, every safeguard, every "wait, don't spam that" rate limit in here came from actually running rooms with it, not from a spec sheet. It's free, it's mine, and I'm giving it away because I'd rather you didn't go through the same trial and error I did. If you moderate rooms too, I hope it saves you the same headaches it saved me.

## Contents

- [Quick start](#quick-start)
- [How it signs in](#how-it-signs-in)
- [Features](#features)
- [Documentation](#documentation)
- [How it's built](#how-its-built)
- [Safety by design](#safety-by-design)
- [Known limits](#known-limits)
- [License & fair use](#license--fair-use)

## Quick start

**Requirements:** [Node.js](https://nodejs.org) 18 or newer. Nothing else — no database, no external services, no build step.

```bash
git clone https://github.com/Darhous/clunhouse-mod.git
cd clunhouse-mod
npm install
npm start
```

Then open **http://localhost:4545**. That's the whole install.

> On Windows you can also just double-click **`تشغيل.bat`** — it starts the server and opens the browser for you.

It works out of the box in any of these three ways — pick whichever fits you:

| Mode | What you need | Where it's set up |
|---|---|---|
| **Clubdeck companion** (zero setup) | [Clubdeck](https://www.clubdeck.app/) installed and logged in on the same machine | Automatic — see [How it signs in](#how-it-signs-in) |
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

Every one of these has its own independent on/off switch in *Settings* — nothing is bundled into an all-or-nothing "automation mode."

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

> GIF search is opt-in: it needs a free [Giphy API key](https://developers.giphy.com/) pasted into the *Settings* tab. Everything else works with zero configuration.

## Documentation

Two reference documents live in [`docs/`](docs/), written straight from the source code rather than from memory — every request/response shape in them was checked against what the code actually sends and receives:

- **[`CLUBHOUSE_API_ENDPOINTS.md`](docs/CLUBHOUSE_API_ENDPOINTS.md)** — every Clubhouse endpoint the app talks to: base URL, auth headers, the "modern client" fingerprint some room actions need, rate-limit behavior, and a full table of every endpoint with its verification status (live-confirmed vs. best-guess vs. known-dead).
- **[`INTERNAL_SERVER_API.md`](docs/INTERNAL_SERVER_API.md)** — every local route this app exposes on `localhost:4545`, how the real-time event stream works, and a deep dive into the room-chat subsystem specifically (context tokens, polling cadence, dedup) for anyone who wants to build something on top of it — a Telegram bridge, a bot, whatever.

Both are written in Arabic, matching the app's own UI language — but every endpoint name, path, and code sample in them is exactly as it appears in the source, so they're just as usable as a technical reference either way.

## How it's built

Plain Node.js (`http` module, no framework) talking directly to Clubhouse's private API — the same one Clubdeck itself uses, reverse-engineered by observation rather than official docs, since Clubhouse doesn't publish one. A 3-second poll loop (`lib/poller.js`) watches the room and pushes updates to the browser over Server-Sent Events — no WebSocket, no external dependency, nothing to configure. The whole frontend is hand-written HTML/CSS/JS — no framework, no bundler, no build step between editing a file and reloading the page.

## Safety by design

Clubhouse silently rate-limits reactions and messages if you send them too fast — I found this out the hard way, more than once. Every bulk action shares a persistent, per-account rate limiter (`lib/featureLimiter.js`) that backs off automatically on a real rejection instead of hammering it further, and every destructive action (kick, end room, delete message) goes through an explicit confirmation dialog naming exactly what it will do before it does it.

## Known limits

A few Clubhouse endpoints are documented as broken, unconfirmed, or deliberately unsupported — see the "status" column in [`CLUBHOUSE_API_ENDPOINTS.md`](docs/CLUBHOUSE_API_ENDPOINTS.md) for the full, honest list rather than a marketing one. The short version: email/password sign-in isn't possible (Clubhouse has no such API), and a couple of legacy endpoints Clubhouse itself has retired are kept in the registry only as a record of what *used* to work.

## License & fair use

Free to use, study, modify, and redistribute under **MIT plus a short attribution addendum** — see [`LICENSE.md`](LICENSE.md) for the exact terms. In plain language: use it however helps you, including to moderate rooms commercially, just don't strip the credit.

Specifically — **please don't remove or edit the credit footer** ("Designed & Developed by Ahmed Darhous" and its links) in any copy or fork of this app. It costs you nothing to leave it, and it's the one thing I'm asking for in exchange for giving this away for free.

---

<p align="center" dir="ltr">
Designed &amp; Developed by <a href="mailto:ahmeddarhous@gmail.com">Ahmed Darhous</a><br/>
<a href="tel:+201030002331">+20 103 000 2331</a> · <a href="mailto:ahmeddarhous@gmail.com">ahmeddarhous@gmail.com</a><br/><br/>
<a href="https://www.instagram.com/darhous/">Instagram</a> ·
<a href="https://www.linkedin.com/in/darhous/">LinkedIn</a> ·
<a href="https://www.facebook.com/ahmed.darhous">Facebook</a> ·
<a href="https://wa.me/201030002331">WhatsApp</a> ·
<a href="https://github.com/darhous">GitHub</a> ·
<a href="https://darhous.github.io/portofolio/">Portfolio</a>
</p>
