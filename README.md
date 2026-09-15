<div align="center">

<img src="public/favicon.svg" width="88" height="88" alt="Clubhouse mod by Darhous logo" />

# Clubhouse mod by Darhous

**A real-time moderator control surface for Clubhouse rooms — self-hosted, no cloud, no middleman.**

[🇬🇧 English](README.md) · [🇪🇬 العربية](README.ar.md)

</div>

---

I built this for one reason: moderating a live Clubhouse room from the phone app alone is genuinely hard — the queue moves faster than you can tap, you can't see who's who at a glance, and there's no undo. This is the tool I wished existed. Every screen, every safeguard, every "wait, don't spam that" rate limit in here came from actually running rooms with it, not from a spec sheet. If you moderate rooms too, I hope it saves you the same headaches it saved me.

## Contents

- [Quick start](#quick-start)
- [How it signs in](#how-it-signs-in)
- [Features](#features)
- [Documentation](#documentation)
- [How it's built](#how-its-built)
- [Safety by design](#safety-by-design)
- [Known limits](#known-limits)

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

## How it signs in

By default, the server looks for **Clubdeck's own local session file** and reads whichever Clubhouse account is currently logged into it — the same way Clubdeck's own device sees you. It resolves automatically to:

```
%LOCALAPPDATA%\Programs\Clubdeck\profile.json
```

`%LOCALAPPDATA%` always points at *your* Windows user folder, so this works unmodified for anyone who clones the repo — nobody's personal file path is hardcoded here. Nothing is copied, cached, or sent anywhere: it's read live, straight off disk, on your own machine.

If you'd rather not depend on Clubdeck at all, use the token or phone sign-in above instead — Clubdeck doesn't need to be installed for either of those. Whichever way you sign in, your credentials never leave your machine: there's no backend, no analytics, no telemetry. The server *is* your machine.

## Features

| Feature | What it does | Powered by |
|---|---|---|
| Live room dashboard | Real-time roster, roles, and room state, refreshed automatically | `get_channel` polling + Server-Sent Events |
| Speaking queue | See who raised a hand, invite one/next-N/all, reorder, back up the queue if it clears unexpectedly | `get_handraise_queue`, `invite_speaker` |
| Stage & audience control | Mute/invite/lower/kick, single-click or bulk, with a shared rate limiter across every bulk action | `mute_speaker`, `invite_speaker`, `uninvite_speaker`, `block_from_channel` |
| Room chat | Read and post to the room's text chat, like/unlike, moderator delete, per-role auto-welcome messages | `get_channel_messages`, `send_channel_message`, `like_channel_message` |
| Reactions & effects | Single, combo, or room-wide reactions and GIFs, throttled to stay under Clubhouse's spam threshold | `emoji_reaction`, `gif_reaction` |
| Automation & protection | VIP auto-invite, blacklist auto-mod with expiry, mic-hog cooldown, speaking time limits, quiet hours, turn rotation | Local rule engine over the poll loop |
| Multi-account | Switch between Clubdeck's session and any number of manually signed-in accounts | `lib/account.js` |
| Live rooms & houses | Browse the public feed, join or watch read-only, manage your Houses and their members | `get_feed_v3`, `get_social_club_members` |
| Direct messages | Read chats, accept/hide requests, bulk-accept | `get_chats`, `accept_dm_conversation_request` |
| Social graph | Search, follow/unfollow/block, mutual followers, who's online among people you follow | `search_users`, `get_followers` |
| Friends & notifications | Background watcher that notifies you when a followed friend joins a room | `lib/friendsWatcher.js` |
| Safe bulk operations | Preview → dry-run → execute, with live progress and one-click cancel — nothing fires blind | `lib/operationManager.js` |
| Session archive & audit log | Every past room saved locally, every action you took logged and searchable | `lib/state.js` |
| Live API log | Every request/response to Clubhouse, timestamped, exportable — for when you need to know exactly what happened | `lib/logBuffer.js` |
| Self-diagnostics | One screen showing server, account, room, and API-contract health — no external calls made | `/api/platform/diagnostics` |

This table is the highlights reel. The full route-by-route reference is in [`docs/`](docs/) — see below.

> GIF search is opt-in: it needs a free [Giphy API key](https://developers.giphy.com/) pasted into the *Settings* tab. Everything else works with zero configuration.

## Documentation

Two reference documents live in [`docs/`](docs/), written straight from the source code rather than from memory — every request/response shape in them was checked against what the code actually sends and receives:

- **[`CLUBHOUSE_API_ENDPOINTS.md`](docs/CLUBHOUSE_API_ENDPOINTS.md)** — every Clubhouse endpoint the app talks to: base URL, auth headers, the "modern client" fingerprint some room actions need, rate-limit behavior, and a full table of every endpoint with its verification status (live-confirmed vs. best-guess vs. known-dead).
- **[`INTERNAL_SERVER_API.md`](docs/INTERNAL_SERVER_API.md)** — every local route this app exposes on `localhost:4545`, how the real-time event stream works, and a deep dive into the room-chat subsystem specifically (context tokens, polling cadence, dedup) for anyone who wants to build something on top of it — a Telegram bridge, a bot, whatever.

Both are in Arabic, matching the app's UI language — but the endpoint names, paths, and code are exactly as they appear in the source either way.

## How it's built

Plain Node.js (`http` module, no framework) talking directly to Clubhouse's private API — the same one Clubdeck itself uses, reverse-engineered by observation rather than official docs, since Clubhouse doesn't publish one. A 3-second poll loop (`lib/poller.js`) watches the room and pushes updates to the browser over Server-Sent Events — no WebSocket, no external dependency, nothing to configure.

## Safety by design

Clubhouse silently rate-limits reactions and messages if you send them too fast — I found this out the hard way. Every bulk action shares a persistent, per-account rate limiter (`lib/featureLimiter.js`) that backs off automatically on a real rejection instead of hammering it further, and every destructive action (kick, end room, delete message) goes through an explicit confirmation dialog naming exactly what it will do.

## Known limits

A few Clubhouse endpoints are documented as broken, unconfirmed, or deliberately unsupported — see the "status" column in [`CLUBHOUSE_API_ENDPOINTS.md`](docs/CLUBHOUSE_API_ENDPOINTS.md) for the full, honest list rather than a marketing one. The short version: email/password sign-in isn't possible (Clubhouse has no such API), and a couple of legacy endpoints Clubhouse itself has retired are kept in the registry only as a record of what *used* to work.

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
