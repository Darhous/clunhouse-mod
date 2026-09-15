# توثيق سيرفر Clubhouse mod by Darhous الداخلي (API المحلي)

مرجع كامل لكل نقاط اتصال السيرفر المحلي (`server.js`) اللي الواجهة (`public/`) بتتكلم معاها، وإزاي البيانات بتتبعت وترجع بينهم. الملف ده **قراءة فقط** — مستخرج من الكود الفعلي بتاريخ 2026-09-15، مفيش أي تعديل حصل في المشروع أثناء كتابته. للتفاصيل عن الإندبوينتس الخارجية بتاعة Clubhouse نفسها، راجع الملف الشقيق: [`CLUBHOUSE_API_ENDPOINTS.md`](./CLUBHOUSE_API_ENDPOINTS.md).

---

## 1) الصورة العامة للمعمارية

```
المتصفح (public/*.js)
   │  fetch('/api/...')  ── REST عادي (طلب/رد واحد)
   │  EventSource('/api/events') ── SSE (بث لحظي من السيرفر للمتصفح فقط، اتجاه واحد)
   ▼
server.js  (Node http.createServer خام — بدون Express/أي framework)
   │
   ├── lib/poller.js        حلقة مراقبة الغرفة (كل 3 ثواني): get_channel + get_handraise_queue
   ├── lib/roomChat.js      منطق شات الغرفة (عند الطلب، مش حلقة دورية من تلقاء نفسه)
   ├── lib/actions.js       كل أفعال الموديريشن الفردية (كتم/دعوة/إنزال/رياكت...)
   ├── lib/account.js       الحساب النشط (Clubdeck / توكين مؤقت / هاتف)
   ├── lib/state.js         تخزين محلي (ملفات JSON): إعدادات، قوائم، أرشيف، إشعارات
   ├── lib/operationManager.js  محرك عمليات جماعية آمن (معاينة/تشغيل/إلغاء)
   ├── lib/friendsWatcher.js    مراقبة أصدقاء أونلاين في الخلفية
   ├── lib/chClient.js      طبقة الاتصال الفعلية بـ Clubhouse (fetch + هيدرز + rate limit)
   └── lib/endpointRegistry.js  سجل توثيقي وصفي لحالة كل عقد Clubhouse (بدون تنفيذ)
   │
   ▼
https://www.clubhouseapi.com/api  (Clubhouse نفسه)
```

- **لا يوجد WebSocket ولا Push حقيقي من Clubhouse.** أي "لحظية" ظاهرة في الواجهة مصدرها **polling** من جوه السيرفر (`poller.js` كل 3 ثواني) ثم بث النتيجة للمتصفح عبر **SSE** (اتجاه واحد بس: سيرفر → متصفح).
- المتصفح نفسه بيعمل `fetch` عادي لأي أمر (كتم، إرسال رسالة...) — مفيش SSE في الاتجاه المعاكس.

---

## 2) قناة التحديث اللحظي: `GET /api/events`

اتصال SSE واحد دائم لكل تاب مفتوح (`text/event-stream`). عند الاتصال بيتبعت فورًا `event: state` بحالة الغرفة الحالية، وبعدين أي حدث جديد بيتوزّع على كل التابات المفتوحة.

### كل أنواع الأحداث المبثوثة

| الحدث | المصدر | البيانات |
|---|---|---|
| `state` | `poller.bus` كل تحديث دورة مراقبة | حالة الغرفة الكاملة (متحدثين، مستمعين، طابور، صلاحيات...) |
| `hand-raise` | `poller.bus` | مستخدم رفع إيده جديد |
| `room-ended` | `poller.bus` | الغرفة خلصت/اتقفلت |
| `auto-action` | `poller.bus` | تم تنفيذ أوتوموديريشن (كتم تلقائي، ترحيب...) بنجاح |
| `auto-action-error` | `poller.bus` | فشل أوتوموديريشن |
| `schedule-executed` / `schedule-error` | `poller.bus` | نتيجة مهمة مجدولة (فتح رفع اليد بعد وضع الهدوء مثلاً) |
| `mod-alert` | `poller.bus` | تنبيه مودريتور (مايك شبح، سعة الغرفة، دخول قائمة سوداء...) |
| `notification` | `friendsWatcher.bus` | صديق دخل غرفة |
| `log` | `chClient.log` | كل طلب/رد/خطأ فعلي لـClubhouse (للسجل الحي في الواجهة) |
| `operation` | `operationManager.bus` | تقدّم عملية جماعية جارية |
| `room-chat-changed` / `room-chat-deleted` / `room-chat-liked` / `room-chat-auto-error` | `roomChat.js` (عبر `emit`) | **بس** لما الحساب النشط نفسه يبعت/يحذف/يعمل لايك — مش لما حد تاني يبعت رسالة (فيه تفصيل في القسم 4) |

---

## 3) الحماية العامة على مستوى السيرفر

- **وضع القراءة فقط (`serverReadOnlyMode`)**: لو مفعّل، أي طلب POST/PUT/PATCH/DELETE يعتبر "تعديل خارجي" (`isExternalMutation()`) بيترفض فورًا بكود `423` — عدا استثناءات محددة (حفظ الإعدادات نفسها، اختيار غرفة، معاينة عملية Dry-Run).
- **هيدرز أمان ثابتة** على كل رد: `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy` بتقفل الكاميرا/الميكروفون/الموقع.
- **تصفية حقول حساسة** (`redactSensitiveFields`) قبل إرجاع أي رد فيه توكن/هاتف/بريد/معرف جهاز للواجهة.
- **حماية بث جماعي إضافية** (`guardBroadcastReactionCooldown`): أي بث جماعي حقيقي (رياكت للكل، GIF للكل، ترحيب للكل) بيتحد بفاصل 30 ثانية بينه وبين اللي قبله، بوابة واحدة مشتركة بين التلاتة.

---

## 4) شات الروم — تفصيل خاص (الأكتر تعقيدًا في المشروع)

الملفات: `lib/roomChat.js` (منطق) + `lib/chatReceipts.js` (منع تكرار) + `public/modules/room-chat.js` (واجهة) + `public/index.html` (تاب "شات الروم").

### الفكرة الأساسية

`roomChat.js` **مش بيعمل polling من تلقاء نفسه**. هو بيقرا من Clubhouse بس لما حد يطلب فعليًا `GET /api/room-chat/messages`، مع طبقة تجميع/كاش داخلية (3 ثواني) عشان لو كذا تاب طلبوا في نفس اللحظة ميتكررش النداء لـClubhouse.

اللي بيحرّك الطلب ده حاليًا هو **واجهة المتصفح نفسها** (`room-chat.js` سطر 274):

```js
setInterval(() => { if (active && !document.hidden) void refresh(); }, 3500);
```

يعني بيتحدّث كل 3.5 ثانية **بس لو تاب "شات الروم" مفتوح فعليًا والمتصفح مش في الخلفية**. لو حبيت تبني أداة خارجية (بوت تيليجرام مثلاً) تتابع الشات، محتاج تعمل الـpolling ده بنفسك من سيرفرك، مش الاعتماد على الواجهة دي.

### الـ`context` — مفتاح الأمان

كل مرة الغرفة أو الحساب يتغيّر، `roomChat.js` بيولّد `context` جديد (UUID عشوائي). أي طلب إرسال/حذف/لايك لازم يبعت نفس الـ`context` الحالي — لو مش متطابق، السيرفر بيرفضه (409) بدل ما ينفذ أمر في غرفة قديمة بالغلط. لازم تجيب الـ`context` أولاً من `GET /api/room-chat` قبل أي عملية كتابة.

### مسارات شات الروم

| المسار | الطريقة | الوصف | يرجع |
|---|---|---|---|
| `/api/room-chat` | GET | حالة الشات الحالية | `{context, channel, topic, connected, canSend, canDelete, canLike, members, settings, autoPending, operation}` |
| `/api/room-chat/messages` | GET | قراءة الرسائل | `?context=<>&cursor=<اختياري>` → `{context, messages:[...], nextCursor, total}` |
| `/api/room-chat/send` | POST | إرسال رسالة | body: `{context, message}` |
| `/api/room-chat/delete` | POST | حذف رسالة (مودريتور بس) | body: `{context, messageId}` |
| `/api/room-chat/like` | POST | لايك/إلغاء لايك | body: `{context, messageId, liked: true\|false}` |
| `/api/room-chat/welcome` | POST | بدء ترحيب تلقائي (رسالة مستقلة لكل شخص) | body: `{context, scope: 'all'\|'moderators'}` → عملية جارية (202) |
| `/api/room-chat/settings` | POST | حفظ نص/تفعيل الترحيب | body: `{template?, autoWelcome?}` |

### شكل الرسالة الموحّد (normalizeMessage)

```json
{
  "id": "1234567890",
  "text": "نص الرسالة",
  "userId": "170378500",
  "name": "اسم المرسل",
  "username": "username",
  "time": "2026-09-13T10:00:00Z",
  "deleted": false,
  "likes": 3,
  "liked": true
}
```

### منع التكرار (`chatReceipts.js`)

Clubhouse بيرفض إرسال نص مطابق حرفيًا لرسالة سابقة. عشان كده كل رسالة اترسلت بينحفظ لها **hash فقط** (مش النص نفسه) محليًا لمدة 24 ساعة، فلو حصل رفض بنفس السبب، Clubhouse mod by Darhous بيتعرف عليه ويوقف عملية الترحيب الجماعي بدل ما يفضل يعيد المحاولة في حلقة مفرغة.

---

## 5) خريطة كل مسارات `/api/*`

### الحساب والملف الشخصي

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/profile` | GET | بيانات المستخدم النشط (بدون توكن) |
| `/api/profile/full` | GET | البروفايل الكامل من Clubhouse |
| `/api/profile/view/:userId` | GET | بروفايل أي مستخدم تاني |
| `/api/profile/bio` \| `/name` \| `/username` | POST | تعديل النبذة/الاسم/اليوزرنيم |
| `/api/account/status` | GET | الحساب النشط + كل الحسابات المتاحة |
| `/api/accounts` | GET | نفس المعلومة بشكل بديل |
| `/api/accounts/:id/activate` | POST | التبديل لحساب تاني (بيوقف مراقبة الغرفة الحالية) |
| `/api/account/login-token` | POST | تسجيل بتوكين (+ userId أو username) |
| `/api/account/phone/start` \| `/complete` | POST | تسجيل دخول برقم الهاتف (OTP) |
| `/api/account/clubhouse-settings` | GET | إعدادات حساب Clubhouse نفسه |

### الغرفة والاتصال

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/channel/select` | POST | مراقبة غرفة (قراءة فقط، من غير انضمام فعلي) |
| `/api/channel/join` | POST | انضمام حقيقي (`join_channel` + بدء المراقبة) |
| `/api/channel/leave` | POST | مغادرة حقيقية |
| `/api/channels` | GET | كل الغرف الحية (من `get_feed_v3`) |
| `/api/hallway` | GET | نفس القايمة بشكل غني للصفحة الرئيسية |
| `/api/hallway/hide` | POST | إخفاء غرفة من الفيد |
| `/api/room/quick-status` | GET | حالة سريعة لأي غرفة بالاسم (بدون الاتصال بيها) |
| `/api/room/replayers` | GET | عارضين الريبلاي (لو الغرفة منتهية) |
| `/api/queue/backup` | GET | آخر نسخة غير فاضية من طابور رفع الإيد |
| `/api/suggested-speakers` | GET | متحدثون مقترحون للغرفة الحالية |
| `/api/recent-speakers` | GET | آخر متحدثين في غرفك السابقة |
| `/api/check-link` | POST | فحص صحة رابط قبل إضافته للغرفة |

### أوامر الحساب نفسه داخل الغرفة

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/action/audience-reply` | POST | رفع إيد أو صعود مباشر (حسب نوع الغرفة) — `{action: 'raise'\|'unraise'}` |
| `/api/action/accept-speaker-invite` | POST | قبول دعوة تحدث معلّقة |
| `/api/action/move-to-audience` | POST | النزول للجمهور بنفسك |

### الموديريشن — فردي وجماعي

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/action/user/:id/mute\|invite\|lower\|reaction\|kick\|promote\|demote` | POST | أكشن فردي على مستخدم |
| `/api/action/user/:id/gif-reaction` | POST | GIF لمستخدم محدد (`{giphyId}`) |
| `/api/action/mute-all` | POST | كتم كل المتحدثين (عدا المحميين والحساب نفسه) |
| `/api/action/mute-non-mods` | POST | كتم كل المتحدثين عدا المودريتورز |
| `/api/action/invite-all` | POST | دعوة كل طابور رفع الإيد (بحد سقف السبيكرز لو مفعّل) |
| `/api/action/invite-all-listeners` | POST | دعوة كل المستمعين (مش بس الرافعين إيدهم) |
| `/api/action/invite-all-vip` | POST | دعوة كل الـVIP الموجودين فعليًا |
| `/api/action/invite-ids` | POST | دعوة IDs محددة بالاسم (`{ids: [...]}`) |
| `/api/action/invite-next` | POST | دعوة أول واحد بس في الطابور |
| `/api/action/invite-next-n` | POST | دعوة أول N في الطابور |
| `/api/action/lower-all` | POST | إنزال كل المتحدثين للجمهور |
| `/api/action/promote-all` | POST | ترقية كل المتحدثين لمودريتور (مودريتور بس يقدر) |
| `/api/action/kick-all-blacklisted` | POST | طرد كل الموجودين في القايمة السوداء |
| `/api/action/quiet-mode` | POST | كتم الكل + قفل رفع الإيد + جدولة فتح تلقائي (`{minutes}`) |
| `/api/action/handraise-lock` | POST | قفل/فتح رفع الإيد يدويًا |
| `/api/action/room-title` | POST | تغيير عنوان الغرفة |
| `/api/action/end-room` | POST | إنهاء الغرفة **(فعل لا رجعة فيه)** |
| `/api/action/room-messages` | POST | تفعيل/تعطيل شات الغرفة |
| `/api/action/room-link` | POST/DELETE | إضافة/حذف رابط مثبّت |
| `/api/action/channel-emoji` \| `/clear` | POST | إيموجي بجانب اسمك في الغرفة |
| `/api/action/bring-to-room/:id` | POST | جلب مستخدم من نتائج البحث للغرفة الحالية |
| `/api/action/reaction-all` | POST | رياكت جماعي (`{value}`) — محمي بفاصل 30 ثانية |
| `/api/action/gif-reaction-all` | POST | GIF جماعي — محمي بنفس الفاصل |
| `/api/action/welcome-all` | POST | ترحيب فوري بالكل (اسم + قلب) — محمي بنفس الفاصل، سقف 50 شخص |

### شات الروم — راجع القسم 4 بالتفصيل

### الرسائل الخاصة (DMs)

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/chats` | GET | `?location=chats\|requests` |
| `/api/chats/:id/messages` | GET/POST | قراءة/إرسال رسالة في محادثة |
| `/api/chats/:id` | DELETE | حذف محادثة |
| `/api/chats/requests/:id/accept\|hide` | POST | قبول/إخفاء طلب رسالة |
| `/api/chats/requests/accept-all` | POST | قبول كل الطلبات المعلّقة دفعة واحدة |

### الشبكة الاجتماعية

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/search` | GET | بحث عن مستخدمين |
| `/api/social/followers` | GET | متابعوك |
| `/api/social/friends-online` | GET | مين من متابعينك أونلاين دلوقتي (مشتق محليًا من `friendsWatcher`) |
| `/api/social/follow\|unfollow\|wave\|block\|unblock/:userId` | POST | فعل اجتماعي على مستخدم |
| `/api/social/blocked` | GET | قائمة المحظورين |
| `/api/social/mutual/:userId` | GET | متابعون مشتركون |
| `/api/social/discover` | GET | أشخاص مقترحون للمتابعة |
| `/api/social/suggested-invites` | GET | مقترحات دعوة |
| `/api/waves` | GET | `?type=sent\|received` |
| `/api/platform/friends-compare` | GET | مقارنة "مين متابعينك أونلاين" (مباشر + مستنتج من الفيد) |

### الهاوسات

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/houses` | GET/POST | قايمة الهاوسات بتاعتك / إنشاء هاوس جديد |
| `/api/houses/:id/leave` | POST | مغادرة هاوس |
| `/api/houses/:id/description` | POST | تعديل الوصف |
| `/api/houses/:id/replays` | GET | ريبلايز الهاوس |
| `/api/houses/:id/members` | GET | أعضاء الهاوس |
| `/api/houses/:id/admin/:userId` | POST/DELETE | تعيين/إزالة أدمن |
| `/api/platform/houses/search` | GET | بحث هاوسات (`?q=`) |
| `/api/platform/houses/:id/follow\|unfollow` | POST | متابعة/إلغاء متابعة هاوس |
| `/api/platform/create-room` | POST | إنشاء غرفة جديدة (يحتاج `confirmCandidate: true` صراحة) |

### الإعدادات والقوائم والأرشيف

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/settings` | GET/POST | كل إعدادات الأتمتة (مفتاح/قيمة عام) |
| `/api/settings/giphy-key` | GET/POST | مفتاح Giphy API (ملف منفصل، غير متتبّع بـGit) |
| `/api/gif/search` | GET | بحث GIF عبر Giphy (`?q=`) |
| `/api/vip` \| `/blacklist` \| `/presets` \| `/protected` \| `/shifts` \| `/modbackup` | GET/POST/DELETE | قوائم عامة (نفس الشكل لكل قايمة) |
| `/api/schedule` | GET/POST/DELETE | مهام مجدولة (فتح رفع اليد بعد وضع الهدوء مثلاً) |
| `/api/audit-log` | GET | سجل كل الأكشنات المنفذة |
| `/api/user-history/:userId` | GET | تاريخ تراكمي لشخص عبر كل الغرف (من سجل الأكشنات) |
| `/api/archive` | GET | قايمة أرشيف الغرف السابقة |
| `/api/archive/:file` | GET/DELETE | تفاصيل/حذف أرشيف غرفة |
| `/api/notifications` | GET/DELETE | إشعارات الأصدقاء المحفوظة |
| `/api/notifications/:id/read` \| `/read-all` | POST | تعليم كمقروء |
| `/api/friends/sightings` | GET | آخر ظهور مرصود لكل صديق |
| `/api/friends/:id/mute` | POST | كتم إشعارات صديق معيّن |

### محرك العمليات الجماعية الآمن (Operations)

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/operations` | GET | كل العمليات (جارية/منتهية) |
| `/api/operations/preview` | POST | معاينة عملية قبل تنفيذها (بدون أي نداء فعلي لـClubhouse) |
| `/api/operations/run` | POST | تشغيل فعلي (أو `dryRun: true` لمحاكاة بدون تنفيذ) |
| `/api/operations/:id` | GET | حالة عملية |
| `/api/operations/:id/cancel` | POST | إلغاء عملية جارية |

**أنواع العمليات المدعومة**: `reaction-sequence` (تفاعلات متتالية على نطاق محدد)، `invite-listeners`، `lower-speakers`، `kick-blacklisted`.

### تشخيص وتوثيق ذاتي

| المسار | الطريقة | الوصف |
|---|---|---|
| `/api/platform/endpoints` | GET | كل محتوى `endpointRegistry.js` (نفس جدول الملف الشقيق) بصيغة JSON |
| `/api/platform/diagnostics` | GET | حالة السيرفر/الحساب/الغرفة/سجل العمليات دفعة واحدة |
| `/api/platform/compatibility` | GET | بصمة العميل الحالية مقابل بصمة "العميل الحديث" |
| `/api/log/export` | GET | تصدير كل سجل الطلبات/الردود كملف `.jsonl` |

---

## 6) شكل رد الخطأ الموحّد من السيرفر المحلي

```json
{ "error": "نص الرسالة بالعربي", "retryAfterMs": 12000 }
```

مع كود HTTP مطابق للمعنى: `400` (طلب غلط)، `403` (صلاحية غير متاحة)، `409` (تعارض حالة — الغرفة/الحساب اتغيّر أثناء التنفيذ)، `423` (وضع القراءة فقط مفعّل)، `429` (تم تجاوز حد الإرسال محليًا)، `502` (Clubhouse نفسه رفض الطلب)، `503` (مفيش جلسة حساب أصلاً).
