import { icon } from './dom.js';

const actionIcons = new Map([
  ['muteAllBtn', 'mute'], ['inviteAllBtn', 'mic'], ['lowerAllBtn', 'down'], ['reactAllBtn', 'reaction'],
  ['reactCurrentBtn', 'reaction'], ['autoMuteNewToggle', 'lock'], ['handraiseLockToggle', 'hand'],
  ['roomMessagesToggle', 'message'], ['inviteAllListenersBtn', 'mic'], ['kickAllBlacklistedBtn', 'shield'],
  ['leaveChannelBtn', 'join'], ['eventModeToggle', 'control'], ['densityToggle', 'dashboard'],
  ['desktopNotifToggle', 'bell'], ['readOnlyModeToggle', 'lock'],
  ['autoInviteAllToggle', 'mic'], ['welcomeSpeakersToggle', 'users'], ['autoFillVacantToggle', 'audience'],
  ['turnRotationToggle', 'refresh'], ['focusModeBtn', 'eye'], ['fullscreenBtn', 'monitor'],
  ['exportSettingsBtn', 'download'], ['importSettingsBtn', 'join'], ['resetAllSettingsBtn', 'alert'],
  ['copyRoomSummaryBtn', 'copy'], ['shareRoomBtn', 'link'], ['backToHallwayBtn', 'dashboard'],
  ['inviteQueueExceptBtn', 'check'], ['restoreQueueBackupBtn', 'refresh'], ['exportMembersCsvBtn', 'download'],
  ['exportLogBtn', 'download'], ['clearLogBtn', 'trash'], ['refreshHallwayBtn', 'refresh'],
  ['createHouseBtn', 'house'], ['exportChatBtn', 'download'], ['deleteChatBtn', 'trash'],
]);

const actionCardIcons = new Map([
  ['muteAllBtn', 'mute'], ['inviteAllBtn', 'mic'], ['lowerAllBtn', 'down'], ['reactAllBtn', 'reaction'],
  ['reactCurrentBtn', 'reaction'], ['autoMuteNewToggle', 'lock'], ['handraiseLockToggle', 'hand'],
  ['roomMessagesToggle', 'message'], ['densityToggle', 'dashboard'], ['desktopNotifToggle', 'bell'],
  ['readOnlyModeToggle', 'lock'], ['autoInviteAllToggle', 'mic'],
  ['welcomeSpeakersToggle', 'users'], ['autoFillVacantToggle', 'audience'], ['turnRotationToggle', 'refresh'],
]);

function owningControl(node) {
  const card = node.closest('.action-card');
  if (!card) return null;
  if (card.id) return card.id;
  const input = card.querySelector('input[id]');
  return input?.id || null;
}

function stripLeadingSymbol(control) {
  for (const node of control.childNodes) {
    if (node.nodeType !== Node.TEXT_NODE || !node.textContent.trim()) continue;
    node.textContent = node.textContent.replace(/^\s*[\p{Extended_Pictographic}\uFE0F\u200D↺↻⬇⬆✕✦⛶▦☰⌘]+\s*/u, '');
    break;
  }
}

function actionNameFromTitle(title = '') {
  if (/كتم/.test(title)) return 'mute';
  if (/طرد|حظر/.test(title)) return 'shield';
  if (/ترقية.*مودريتور/.test(title)) return 'crown';
  if (/إلغاء.*مودريتور|إنزال/.test(title)) return 'down';
  if (/رفع|دعوة|سبيكر|تحدث/.test(title)) return 'mic';
  if (/رياكت|تفاعل/.test(title)) return 'reaction';
  if (/حذف|مسح/.test(title)) return 'trash';
  if (/نسخ/.test(title)) return 'copy';
  if (/تحديث|استرجاع/.test(title)) return 'refresh';
  if (/غرفة|هاوس|هالواي/.test(title)) return 'house';
  if (/تنبيه|طوارئ|Reset|إنهاء/.test(title)) return 'alert';
  if (/قفل|قراءة فقط/.test(title)) return 'lock';
  if (/جدول|وقت|دقايق|تركيز/.test(title)) return 'clock';
  if (/شاشة|عرض/.test(title)) return 'monitor';
  if (/حفظ/.test(title)) return 'archive';
  if (/إضافة/.test(title)) return 'check';
  return 'more';
}

function startsWithSymbol(value = '') {
  return /^\s*[\p{Extended_Pictographic}\uFE0F\u200D↺↻⬇⬆✕✦⛶▦☰⌘♻]+/u.test(value);
}

export function applyStaticIcons(root = document) {
  root.querySelectorAll('.action-icon').forEach((slot) => {
    const id = owningControl(slot);
    const name = actionCardIcons.get(id);
    if (!name || slot.querySelector('svg')) return;
    slot.replaceChildren(icon(name));
  });

  for (const [id, name] of actionIcons) {
    const control = root.getElementById?.(id) || root.querySelector?.(`#${CSS.escape(id)}`);
    if (!control || control.closest('.action-card') || control.querySelector(':scope > svg')) continue;
    stripLeadingSymbol(control);
    control.prepend(icon(name));
  }
}

export function applyDynamicIcons(root = document) {
  root.querySelectorAll?.('.icon-btn:not(:has(svg))').forEach((button) => {
    const label = button.title || button.getAttribute('aria-label') || button.textContent.trim();
    button.setAttribute('aria-label', label || 'إجراء');
    button.replaceChildren(icon(actionNameFromTitle(label)));
  });
  root.querySelectorAll?.('button:not(:has(svg))').forEach((button) => {
    const value = button.textContent.trim();
    if (!['✕', '×', '🗑', '🗑️'].includes(value)) return;
    button.setAttribute('aria-label', button.title || (value.startsWith('🗑') ? 'حذف' : 'إغلاق'));
    button.replaceChildren(icon(value.startsWith('🗑') ? 'trash' : 'close'));
  });
  root.querySelectorAll?.('button:not(:has(svg))').forEach((button) => {
    if (button.closest('#emojiGrid, #reactionEmojiKeyboard, .preset-row, .emoji-grid, .quick-reaction-picker-row, .effects-burst-row') || !startsWithSymbol(button.textContent)) return;
    const label = button.textContent.trim();
    stripLeadingSymbol(button);
    button.prepend(icon(actionNameFromTitle(label)));
  });
  root.querySelectorAll?.('.macro-card > span:first-child:not(:has(svg)), .user-avatar--all:not(:has(svg))').forEach((slot) => {
    const context = slot.parentElement?.textContent || '';
    slot.replaceChildren(icon(actionNameFromTitle(context)));
  });
  root.querySelectorAll?.('.card-head h3:not(:has(svg))').forEach((heading) => {
    if (!startsWithSymbol(heading.textContent)) return;
    const label = heading.textContent.trim();
    stripLeadingSymbol(heading);
    heading.prepend(icon(actionNameFromTitle(label)));
  });
}

export { icon };
