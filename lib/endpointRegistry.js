'use strict';

// سجل مركزي لحقيقة عقود Clubhouse في Clubhouse mod by Darhous.
// الحالات هنا وصفية فقط ولا تنفذ أي probe أو طلب خارجي تلقائيًا.
const ENDPOINTS = Object.freeze([
  ['get_profile', 'profile', 'verified', 'read', 'قراءة الملف الشخصي'],
  ['update_bio', 'profile', 'human', 'write', 'تعديل النبذة'],
  ['update_name', 'profile', 'human', 'write', 'تعديل الاسم'],
  ['update_username', 'profile', 'human', 'write', 'تعديل اسم المستخدم'],
  ['get_feed_v3', 'discovery', 'verified', 'read', 'الفيد الحديث للغرف المباشرة'],
  ['get_channel', 'room', 'verified', 'read', 'حالة الغرفة والأعضاء والصلاحيات'],
  ['join_channel', 'room', 'human', 'write', 'إدخال الحساب إلى الغرفة'],
  ['active_ping', 'room', 'verified', 'write', 'نبضة حضور دورية لإبقاء الحساب داخل الغرفة'],
  ['leave_channel', 'room', 'human', 'write', 'مغادرة الغرفة فعليًا'],
  ['hide_channel', 'discovery', 'human', 'write', 'إخفاء غرفة من الفيد'],
  ['get_handraise_queue', 'room', 'contract', 'read', 'GET معروف من Clubdeck؛ السجل الحالي يرجع 400 حتى مع البصمة الحديثة؛ فحص الصلاحية وتأخير إعادة المحاولة'],
  ['get_channel_messages', 'room-chat', 'verified', 'read', 'قراءة الشات وصفحاته — متحقق حيًا في غرفة Test بتاريخ 2026-09-13'],
  ['send_channel_message', 'room-chat', 'verified', 'write', 'إرسال نص لشات الروم وظهوره في إعادة القراءة — متحقق حيًا 2026-09-13'],
  ['like_channel_message', 'room-chat', 'verified', 'write', 'channel + message_id؛ تأكد ارتفاع like_count وتغير viewer_has_liked حيًا 2026-09-13'],
  ['unlike_channel_message', 'room-chat', 'verified', 'write', 'إلغاء لايك رسالة الروم — متحقق حيًا 2026-09-13'],
  ['delete_channel_message', 'room-chat', 'verified', 'destructive', 'حذف رسالة اختبار للحساب تأكد حيًا 2026-09-13؛ الواجهة تقيد حذف الرسائل بالمودريتور'],
  ['audience_reply', 'room', 'contract', 'write', 'رفع أو سحب يد الحساب الحالي'],
  ['become_speaker', 'room', 'verified', 'write', 'صعود مباشر إلى المسرح في غرف الصعود التلقائي — متحقق حيًا'],
  ['update_microphone_enabled', 'room', 'verified', 'write', 'تحديث حالة مايك الحساب بعد الصعود — متحقق حيًا'],
  ['accept_speaker_invite', 'room', 'contract', 'write', 'قبول دعوة التحدث'],
  ['mute_speaker', 'moderation', 'verified', 'write', 'كتم متحدث'],
  ['invite_speaker', 'moderation', 'verified', 'write', 'دعوة مستمع إلى المسرح'],
  ['uninvite_speaker', 'moderation', 'verified', 'write', 'إنزال متحدث إلى الجمهور'],
  ['block_from_channel', 'moderation', 'verified', 'destructive', 'إزالة عضو من الغرفة'],
  ['change_handraise_settings', 'moderation', 'verified', 'write', 'فتح أو قفل رفع اليد'],
  ['set_channel_title', 'moderation', 'verified', 'write', 'تغيير عنوان الغرفة'],
  ['end_channel', 'moderation', 'verified', 'destructive', 'إنهاء الغرفة'],
  ['make_moderator', 'moderation', 'verified', 'write', 'ترقية متحدث إلى مودريتور'],
  ['make_moderator:value=false', 'moderation', 'unsupported', 'destructive', 'اتأكد حيًا (2026-09-09) إن Clubhouse بيرفضها بغلطة "already a moderator" — الشكل ده مش صحيح، محتاج endpoint أو حقل مختلف'],
  ['change_handraise_settings', 'moderation', 'unsupported', 'write', 'كانت شغالة قبل كده؛ اتأكد حيًا (2026-09-09) إنها بترجع 404 دلوقتي — على الأغلب Clubhouse غيّر أو ألغى الـendpoint ده'],
  ['emoji_reaction', 'engagement', 'verified', 'write', 'إرسال تفاعل مؤكد (نص حر أو إيموجي، فردي أو كومبو). اتأكد حيًا (2026-09-10): إرسال إيموجي من كتالوج audio_reactions الحقيقي بيشغّل صوت فعلي عند الطرف التاني — مفيش حاجة لحقل reaction_id منفصل.'],
  ['gif_reaction', 'engagement', 'contract', 'write', 'اتأكد حيًا (2026-09-10): النداء بـ{channel,user_id,giphy_id} بيرجع نجاح حتى بمعرّف وهمي — شكل الـGIF الفعلي عند الطرف التاني لسه محتاج تأكيد بمعرّف حقيقي من Giphy'],
  ['set_user_channel_emoji', 'engagement', 'unsupported', 'write', 'اتأكد حيًا (2026-09-10): بيرجع 404 رغم وجوده في كود Clubdeck — غالبًا endpoint قديم أو اتلغى'],
  ['remove_user_channel_emoji', 'engagement', 'unsupported', 'write', 'اتأكد حيًا (2026-09-10): بيرجع 404 نفس set_user_channel_emoji'],
  ['background_music', 'engagement', 'unsupported', 'write', 'مفيش أي أثر لها في كود Clubdeck نفسه — يمكن ميزة تطبيق الموبايل بس، مفيش endpoint مؤكد'],
  ['paid_reactions', 'engagement', 'unsupported', 'write', 'مفيش أي أثر لها في كود Clubdeck نفسه، وبتحتاج فلوس حقيقية لو موجودة — مش هتتنفذ من غير endpoint مؤكد وتأكيد صريح منك في كل مرة'],
  ['invite_to_existing_channel', 'room', 'human', 'write', 'دعوة مستخدم إلى الغرفة'],
  ['enable_channel_messages', 'room', 'verified', 'write', 'فتح رسائل الغرفة'],
  ['disable_channel_messages', 'room', 'verified', 'write', 'قفل رسائل الغرفة'],
  ['add_channel_link', 'room', 'human', 'write', 'إضافة رابط للغرفة'],
  ['remove_channel_link', 'room', 'human', 'write', 'إزالة رابط الغرفة'],
  ['check_channel_link', 'room', 'verified', 'read', 'فحص رابط الغرفة'],
  ['get_chats', 'messages', 'verified', 'read', 'قائمة المحادثات والطلبات'],
  ['get_chat_messages', 'messages', 'verified', 'read', 'رسائل محادثة'],
  ['accept_dm_conversation_request', 'messages', 'verified', 'write', 'قبول طلب رسالة'],
  ['hide_dm_conversation_request', 'messages', 'verified', 'write', 'إخفاء طلب رسالة'],
  ['delete_conversation', 'messages', 'human', 'destructive', 'حذف محادثة'],
  ['send_chat_message', 'messages', 'unsupported', 'write', 'إرسال رسالة مباشرة'],
  ['search_users', 'social', 'verified', 'read', 'البحث عن مستخدمين'],
  ['get_followers', 'social', 'verified', 'read', 'متابعو الحساب'],
  ['follow', 'social', 'human', 'write', 'متابعة مستخدم'],
  ['unfollow', 'social', 'human', 'write', 'إلغاء متابعة مستخدم'],
  ['block', 'social', 'human', 'destructive', 'حظر مستخدم'],
  ['unblock', 'social', 'human', 'write', 'فك حظر مستخدم'],
  ['get_blocked_users', 'social', 'verified', 'read', 'قائمة المحظورين'],
  ['get_social_club_members', 'houses', 'verified', 'read', 'أعضاء الهاوس'],
  ['get_replays', 'houses', 'verified', 'read', 'ريبلايز الهاوس'],
  ['create_social_club', 'houses', 'human', 'write', 'إنشاء هاوس'],
  ['leave_social_club', 'houses', 'human', 'destructive', 'مغادرة هاوس'],
  ['add_club_admin', 'houses', 'human', 'write', 'إضافة أدمن هاوس'],
  ['remove_club_admin', 'houses', 'human', 'destructive', 'إزالة أدمن هاوس'],
  ['get_settings', 'account', 'verified', 'read', 'قراءة إعدادات Clubhouse'],
  ['create_channel', 'roadmap', 'candidate', 'write', 'إنشاء غرفة — يحتاج إثبات حديث'],
  ['search_clubs', 'roadmap', 'candidate', 'read', 'بحث الهاوسات — يحتاج مكافئ حديث'],
  ['follow_club', 'roadmap', 'candidate', 'write', 'متابعة هاوس — يحتاج مكافئ حديث'],
  ['unfollow_club', 'roadmap', 'candidate', 'write', 'إلغاء متابعة هاوس — يحتاج مكافئ حديث'],
  ['get_channels', 'legacy', 'unsupported', 'read', 'قديم؛ استُبدل بـ get_feed_v3'],
  ['get_following', 'legacy', 'unsupported', 'read', 'أعاد 404 في الاختبار الحي'],
  ['get_online_friends', 'legacy', 'candidate', 'read', 'قديم؛ يوجد بديل مشتق من الفيد'],
  ['start_phone_number_auth', 'account', 'human', 'write', 'إرسال OTP للهاتف بطلب بشري صريح'],
  ['complete_phone_number_auth', 'account', 'human', 'write', 'إكمال OTP وإنشاء حساب جلسة مؤقت'],
  ['email_auth', 'account', 'unsupported', 'write', 'لا يوجد عقد API مثبت لتسجيل البريد في المصادر الحالية'],
  ['logout', 'legacy', 'deferred', 'destructive', 'غير مناسب لجلسة Clubdeck المشتركة'],
].map(([name, domain, status, impact, description]) => Object.freeze({ name, domain, status, impact, description })));

const STATUS_LABELS = Object.freeze({
  verified: 'مؤكد حيًا',
  contract: 'عقد مؤكد محليًا',
  human: 'جاهز لضغطة بشرية',
  experimental: 'تجريبي',
  candidate: 'مرشح للتحقق',
  unsupported: 'غير مدعوم',
  deferred: 'مؤجل عمدًا',
});

function listEndpoints() {
  return ENDPOINTS.map((entry) => ({ ...entry, statusLabel: STATUS_LABELS[entry.status] || entry.status }));
}

function endpointSummary() {
  return listEndpoints().reduce((summary, endpoint) => {
    summary.total++;
    summary.byStatus[endpoint.status] = (summary.byStatus[endpoint.status] || 0) + 1;
    summary.byDomain[endpoint.domain] = (summary.byDomain[endpoint.domain] || 0) + 1;
    return summary;
  }, { total: 0, byStatus: {}, byDomain: {} });
}

function getEndpoint(name) {
  const normalized = String(name || '').replace(/^\//, '');
  return listEndpoints().find((endpoint) => endpoint.name === normalized) || null;
}

module.exports = { listEndpoints, endpointSummary, getEndpoint, STATUS_LABELS };
