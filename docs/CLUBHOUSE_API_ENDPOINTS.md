# توثيق إندبوينتس Clubhouse الخارجية (Clubhouse mod by Darhous)

مرجع كامل لكل نقاط اتصال Clubhouse الخاصة (private API) اللي Clubhouse mod by Darhous بيستخدمها أو وثّقها. هذا الملف **قراءة فقط** — مُستخرج من كود المشروع الفعلي بتاريخ 2026-09-15، مفيش أي تعديل حصل في المشروع نفسه أثناء كتابته.

> **ملاحظة أساسية**: الـAPI ده **غير موثّق رسميًا من Clubhouse** — نفس الواجهة الخاصة اللي تطبيق Clubdeck (والتطبيق الرسمي نفسه) بيستخدمها. أسماء الحقول والمسارات هنا مبنية على رصد فعلي لسلوك الـAPI (اختبار حي، أو تحليل كود Clubdeck)، مش على توثيق منشور. أي endpoint ممكن يتغيّر أو يتقفل من غير سابق إنذار.

---

## 1) الأساسيات: العنوان، الهوية، الهيدرز

**Base URL:** `https://www.clubhouseapi.com/api`
**الطريقة**: `fetch()` مباشر من Node (بدون أي مكتبة HTTP خارجية) — ملف [`lib/chClient.js`](../lib/chClient.js).

كل طلب بيتبعت بنفس الهيدرز اللي التطبيق الحقيقي بيبعتها، مبنية من "بروفايل" الحساب النشط (device fingerprint + توكن):

```
Content-Type: application/json; charset=utf-8
Accept: application/json
User-Agent: <بصمة الجهاز — عادة clubhouse/<build> (Linux; Android 13; ...)>
CH-Languages: en-US
CH-Locale: en_US
CH-AppBuild: <رقم بناء التطبيق>
CH-AppVersion: <رقم نسخة التطبيق>
CH-UserID: <معرف المستخدم النشط>
CH-DeviceId: <بصمة جهاز ثابتة>
CH-TimeZone: UTC
Accept-Language: en-US;q=1
Authorization: Token <auth token>
```

المصدر الافتراضي للبروفايل: جلسة Clubdeck الحقيقية المثبتة على الجهاز (`lib/clubdeckProfile.js`) — أو حساب مؤقت بتوكن/رقم هاتف مسجّل يدويًا (`lib/account.js`)، بدون ما يتكتب أي توكن أو باسورد على القرص إطلاقًا.

### طريقتين للنداء

- **GET**: البيانات بتتحول لـquery string بـ`URLSearchParams`.
- **POST**: البيانات بتتحول لـJSON body عادي.

```js
// من chClient.js
const apiPost = (pathName, body, profileOverride) => request('POST', pathName, body, profileOverride);
const apiGet  = (pathName, query, profileOverride) => request('GET', pathName, query, profileOverride);
```

### بصمة "العميل الحديث" (MODERN_ROOM_CLIENT)

Clubhouse ألغى دعم بعض إندبوينتس المسرح (الصعود، التصويت، الرياكت، الشات...) بالبصمة القديمة اللي جلسة Clubdeck المثبتة بتستخدمها. الحل: أي endpoint من الفئة دي بيتنادى بـheaders بديلة (بصمة تطبيق أندرويد أحدث)، بينما باقي الطلبات العادية (قراءة الحالة، الانضمام...) بتفضل على بصمة Clubdeck الأصلية:

```js
const MODERN_ROOM_CLIENT = {
  appBuild: '1038',
  appVersion: '26.08.18',
  userAgentStatic: 'clubhouse/1038 (Linux; Android 13; Scale/2.75)',
};
const apiPostModernRoom = (pathName, body, profileOverride) => request('POST', pathName, body, { ...profileOverride, ...MODERN_ROOM_CLIENT });
const apiGetModernRoom  = (pathName, query, profileOverride) => request('GET', pathName, query, { ...profileOverride, ...MODERN_ROOM_CLIENT });
```

الإندبوينتس اللي بتستخدم البصمة الحديثة فعليًا في الكود: `audience_reply`، `become_speaker`، `update_microphone_enabled`، `emoji_reaction`، `gif_reaction`، `get_handraise_queue`.

### حماية من الأرقام الكبيرة

معرّفات الهاوسات (`social_club_id`) أكبر من أقصى رقم JS قادر يمثله بدقة، فـ`JSON.parse` العادي بيقرّبه لرقم غلط بصمت. الحل: أي رقم خام أطول من 15 رقمة بيتلف بعلامات تنصيص قبل الـparse عشان يفضل نص بدقته الكاملة.

---

## 2) الحماية من الحظر المؤقت (Rate Limiting)

Clubhouse بيرفض بعض الميزات مؤقتًا (429 "high usage of this feature") لو استُخدمت بسرعة كبيرة. Clubhouse mod by Darhous عنده طبقة حماية محلية في [`lib/featureLimiter.js`](../lib/featureLimiter.js) — بوابة واحدة لكل (حساب + فئة ميزة):

| الفئة | الإندبوينتس المشمولة | القيود |
|---|---|---|
| `room-engagement` | `emoji_reaction`, `gif_reaction`, `send_channel_message` | حد أدنى 5 ثواني بين كل نداء ونداء + أقصى 3 نداءات كل 60 ثانية |
| `room-membership` | `join_channel`, `leave_channel` | نفس القيود |
| `room-chat-likes` | `like_channel_message`, `unlike_channel_message` | نفس القيود |

**ملاحظة مهمة**: `send_channel_message` بيشارك **نفس سلة** الرياكتس (`room-engagement`) — يعني لو شغّال ترحيب رياكت جماعي وبوت شات في نفس الوقت، هيتقفلوا مع بعض بسرعة.

لو Clubhouse رجّع 429 فعليًا، السلة بتتقفل بالكامل لمدة (مأخوذة من هيدر `Retry-After` لو موجود، وإلا 3 دقايق افتراضيًا) — أي نداء تاني في نفس السلة أثناء القفل بيترفض فورًا من غير ما يوصل لـClubhouse خالص. الحالة دي بتتحفظ على القرص (مش في الذاكرة بس) عشان تنجو من إعادة تشغيل السيرفر.

الأكشنات الجماعية (`bulk()` في `actions.js`) بتضيف كمان فاصل زمني بين كل مستخدم والتاني (افتراضي 250ms، وصولًا لـ5000ms للترحيب الجماعي تحديدًا لأنه أكتر حساسية).

---

## 3) الجدول الكامل — كل الإندبوينتس المسجّلة

مصدر الجدول: [`lib/endpointRegistry.js`](../lib/endpointRegistry.js) — سجل حقيقة مركزي بيوصف حالة كل عقد، **بدون** أي استدعاء فعلي (وصفي بس). الحالات:

- **مؤكد حيًا (verified)** — جُرّب فعليًا وشغال.
- **عقد مؤكد محليًا (contract)** — الشكل معروف من كود Clubdeck، مش مجرّب لايف بنفس الحساب.
- **جاهز لضغطة بشرية (human)** — الكود جاهز بس محتاج تأكيد المستخدم يدويًا كل مرة (فعل حساس/لا رجعة فيه).
- **مرشح للتحقق (candidate)** — تخمين معقول، محتاج اختبار حي.
- **غير مدعوم (unsupported)** — جُرّب وفشل (404/رفض) أو اتلغى من Clubhouse.
- **مؤجل عمدًا (deferred)** — قرار واعي بعدم التنفيذ.

### 3.1 الغرفة (room)

| الإندبوينت | الحالة | الوصف |
|---|---|---|
| `get_channel` | مؤكد حيًا | حالة الغرفة الكاملة (أعضاء، صلاحيات، إعدادات) — بيتنادى كل 3 ثواني في حلقة المراقبة |
| `join_channel` | جاهز لضغطة بشرية | إدخال الحساب فعليًا للغرفة |
| `leave_channel` | جاهز لضغطة بشرية | مغادرة حقيقية على سيرفر Clubhouse (مش بس وقف مراقبة محلية) |
| `active_ping` | مؤكد حيًا | نبضة حضور دورية — لازمة لإبقاء الحساب "داخل" الغرفة فعليًا، القراءة وحدها مش كفاية |
| `hide_channel` | جاهز لضغطة بشرية | إخفاء غرفة من الفيد |
| `get_handraise_queue` | عقد مؤكد محليًا | **GET** فقط (مش POST) — بيحتاج بصمة العميل الحديث، لسه بيرجع 400 حتى معاها في بعض السجلات، فيه إعادة محاولة مؤجلة تلقائيًا |
| `audience_reply` | عقد مؤكد محليًا | رفع/سحب يد الحساب الحالي (`raise_hands`/`unraise_hands`) — بصمة حديثة |
| `become_speaker` | مؤكد حيًا | صعود مباشر للمسرح في غرف الصعود التلقائي — بصمة حديثة |
| `update_microphone_enabled` | مؤكد حيًا | تفعيل المايك بعد الصعود — بصمة حديثة |
| `accept_speaker_invite` | عقد مؤكد محليًا | قبول دعوة تحدث معلّقة |
| `invite_to_existing_channel` | جاهز لضغطة بشرية | دعوة مستخدم (من نتائج بحث مثلاً) لغرفة متصلة حاليًا |
| `enable_channel_messages` / `disable_channel_messages` | مؤكد حيًا | فتح/قفل شات الغرفة النصي |
| `add_channel_link` / `remove_channel_link` | جاهز لضغطة بشرية | رابط مثبّت أعلى الغرفة |
| `check_channel_link` | مؤكد حيًا | فحص صحة رابط قبل إضافته |

### 3.2 موديريشن (moderation)

| الإندبوينت | الحالة | الوصف |
|---|---|---|
| `mute_speaker` | مؤكد حيًا | كتم متحدث `{channel, user_id}` |
| `invite_speaker` | مؤكد حيًا | دعوة مستمع للمسرح |
| `uninvite_speaker` | مؤكد حيًا | إنزال متحدث للجمهور |
| `block_from_channel` | مؤكد حيًا **(فعل مدمّر)** | إزالة/طرد عضو من الغرفة |
| `change_handraise_settings` | ⚠️ **غير مدعوم حاليًا** | كانت شغالة، اتأكد حيًا (2026-09-09) إنها بترجع 404 — على الأغلب Clubhouse ألغاها |
| `set_channel_title` | مؤكد حيًا | تغيير عنوان الغرفة |
| `end_channel` | مؤكد حيًا **(فعل مدمّر)** | إنهاء الغرفة بالكامل |
| `make_moderator` | مؤكد حيًا (ترقية) / **غير مدعوم** (تنزيل بـ`value:false` — بيرفضها بغلطة "already a moderator") | ترقية متحدث لمودريتور |

### 3.3 شات الغرفة (room-chat) — كله مؤكد حيًا بتاريخ 2026-09-13

| الإندبوينت | الطريقة | Request | Response | ملاحظات |
|---|---|---|---|---|
| `get_channel_messages` | **GET** | `{channel, is_chronological_order: 0, next_cursor?}` | `{messages: [...], next_cursor, num_messages}` | كل رسالة فيها `message_id`, `message`, `user_id`/`user_profile`, `time_created`, `is_deleted`, `like_count`, `viewer_has_liked` |
| `send_channel_message` | POST | `{channel, message}` | `{success: true}` | Clubhouse بيرفض نص **مطابق حرفيًا** لرسالة سابقة بغلطة مخصصة ("looks like that's been said already") |
| `like_channel_message` | POST | `{channel, message_id}` | `{success: true}` | تأكد ارتفاع `like_count` وتغيّر `viewer_has_liked` حيًا |
| `unlike_channel_message` | POST | `{channel, message_id}` | `{success: true}` | |
| `delete_channel_message` | POST **(فعل مدمّر)** | `{channel, message_id}` | `{success: true}` | الواجهة بتقيّده بالمودريتور بس (قيد تطبيقي، مش من Clubhouse نفسه) |

### 3.4 التفاعلات (engagement)

| الإندبوينت | الحالة | Request | ملاحظات |
|---|---|---|---|
| `emoji_reaction` | مؤكد حيًا | `{channel, user_id, emoji}` (بصمة حديثة) | الحقل الحقيقي اسمه `emoji` مش `value`؛ بيقبل نص حر مش بس إيموجي واحد؛ إرسال إيموجي من كتالوج `audio_reactions` الحقيقي بيشغّل صوت فعلي عند الطرف التاني |
| `gif_reaction` | عقد مؤكد محليًا | `{channel, user_id, giphy_id}` (بصمة حديثة) | بيرجع نجاح حتى بمعرّف وهمي — الشكل الفعلي عند الطرف التاني محتاج تأكيد بمعرّف Giphy حقيقي |
| `set_user_channel_emoji` / `remove_user_channel_emoji` | **غير مدعوم** | — | بيرجعوا 404 رغم وجودهم في كود Clubdeck — غالبًا اتلغوا |
| `background_music` / `paid_reactions` | **غير مدعوم** | — | مفيش أي أثر ليهم في كود Clubdeck نفسه؛ لو `paid_reactions` موجودة فعليًا فهي بفلوس حقيقية ومش هتتنفذ من غير تأكيد صريح |

### 3.5 الملف الشخصي (profile) والحساب (account)

| الإندبوينت | الحالة | ملاحظات |
|---|---|---|
| `get_profile` | مؤكد حيًا | `{user_id}` → `{user_profile}` — نفس الإندبوينت مستخدم للتحقق من صحة توكين مُدخل يدويًا |
| `update_bio` / `update_name` / `update_username` | جاهز لضغطة بشرية | تعديلات ظاهرة للعامة |
| `get_settings` | مؤكد حيًا | إعدادات حساب Clubhouse نفسه (قراءة) |
| `start_phone_number_auth` | جاهز لضغطة بشرية | `{phone_number}` بصيغة دولية → إرسال OTP |
| `complete_phone_number_auth` | جاهز لضغطة بشرية | `{phone_number, verification_code}` → `{auth_token, user_profile}` عند النجاح |
| `email_auth` | **غير مدعوم** | مفيش عقد API مثبت لتسجيل دخول بالبريد في أي مصدر تم فحصه |

### 3.6 الاكتشاف (discovery)

| الإندبوينت | الحالة | ملاحظات |
|---|---|---|
| `get_feed_v3` | مؤكد حيًا | مصدر الحقيقة لقائمة الغرف الحية (الهالواي) — استبدل `get_channels` القديم اللي بيرجع 404 دلوقتي |
| `get_channels` | **غير مدعوم (قديم)** | استُبدل بـ`get_feed_v3` |

### 3.7 الرسائل الخاصة (messages / DMs)

| الإندبوينت | الحالة | ملاحظات |
|---|---|---|
| `get_chats` | مؤكد حيًا | `{location: 'chats'\|'requests'}` |
| `get_chat_messages` | مؤكد حيًا | `{chat_id}` |
| `send_chat_message` | **مرشح غير مؤكد** | الشكل تخمين (`message_body`) — لسه محتاج تأكيد حي |
| `accept_dm_conversation_request` / `hide_dm_conversation_request` | مؤكد حيًا | قبول/إخفاء طلب رسالة |
| `delete_conversation` | جاهز لضغطة بشرية (فعل مدمّر) | |

### 3.8 الشبكة الاجتماعية (social)

| الإندبوينت | الحالة | ملاحظات |
|---|---|---|
| `search_users` | مؤكد حيًا | `{query}` |
| `get_followers` | مؤكد حيًا | `{user_id}` |
| `follow` / `unfollow` | جاهز لضغطة بشرية | |
| `block` (فعل مدمّر) / `unblock` | جاهز لضغطة بشرية | |
| `get_blocked_users` | مؤكد حيًا | |
| `send_wave` | مستخدم في السيرفر (`/api/social/wave/*`) بدون تسجيل صريح في الـregistry | |
| `get_mutual_follows`, `get_suggested_follows_all`, `get_group_suggested_invites`, `get_initiated_waves`, `get_received_waves`, `get_online_friends` | مستخدمة فعليًا في السيرفر (بعضها "مرشح/قديم" حسب الـregistry) | `get_online_friends` مصنّف "قديم — يوجد بديل مشتق من الفيد" |

### 3.9 الهاوسات (houses)

| الإندبوينت | الحالة | ملاحظات |
|---|---|---|
| `get_social_club_members` | مؤكد حيًا | أعضاء الهاوس |
| `get_replays` | مؤكد حيًا | ريبلايز الهاوس |
| `create_social_club` | جاهز لضغطة بشرية | إنشاء هاوس |
| `leave_social_club` | جاهز لضغطة بشرية (فعل مدمّر) | |
| `add_club_admin` / `remove_club_admin` | جاهز لضغطة بشرية | |
| `update_social_club_description` | مستخدمة في السيرفر | تعديل وصف هاوس |
| `search_clubs`, `follow_club`, `unfollow_club` | **مرشح — يحتاج مكافئ حديث** | خارطة طريق (roadmap) |

### 3.10 خارطة الطريق / قديم / مؤجل

| الإندبوينت | الحالة | ملاحظات |
|---|---|---|
| `create_channel` | مرشح | إنشاء غرفة — يحتاج إثبات حديث |
| `get_following` | **غير مدعوم** | رجع 404 في الاختبار الحي |
| `logout` | **مؤجل عمدًا** | غير مناسب لجلسة Clubdeck المشتركة (Clubhouse mod by Darhous بيقرا جلسة Clubdeck نفسها، مش بيملكها) |

---

## 4) إندبوينتس تانية مستخدمة فعليًا في `server.js` (مش كلها متسجّلة صراحة في `endpointRegistry.js`)

دول لقيتهم في كود السيرفر مباشرة (نداءات `apiPost`/`apiGet` صريحة) بدون سطر مخصص لهم في الـregistry — أغلبهم قراءة بسيطة:

`get_suggested_speakers`, `get_recent_channels_speakers`, `get_channel_replayers`, `search_clubs`, `follow_club`, `unfollow_club`, `create_channel`, `hide_channel`.

---

## 5) شكل الأخطاء الموحّد

أي خطأ من `chClient.js` بيرجع كـ `Error` جافاسكريبت عادي بخصائص إضافية:

```js
{
  message: "...",       // error_message من Clubhouse أو "HTTP <status>"
  status: 429,          // كود حالة HTTP الحقيقي
  body: {...},          // الرد الخام كامل
  retryAfterMs: 12000,  // لو Clubhouse بعت هيدر Retry-After
}
```

هذا الشكل هو اللي بيتنشر لأي مكان في المشروع (السيرفر المحلي، الـbulk actions، الـfeatureLimiter) عشان يقرر يوقف عملية جماعية فورًا لو 429 حصل.
