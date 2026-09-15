import { announce, byId } from './dom.js';
import { applyDynamicIcons, applyStaticIcons, icon } from './icons.js';
import { confirmAction, inputAction, installDialogDismissal } from './dialogs.js';

const workspaceNames = {
  currentroom: 'الغرفة الحالية',
  roomchat: 'شات الروم',
  quick: 'التحكم السريع', effects: 'تأثيرات', queue: 'طابور التحدث', members: 'المسرح والجمهور', search: 'البحث داخل الغرفة',
  advanced: 'الأوامر المتقدمة', hallway: 'الغرف المباشرة', houses: 'الهاوسات', messages: 'الرسائل',
  social: 'الشبكة الاجتماعية', friends: 'الأصدقاء والإشعارات', profile: 'الملف الشخصي', settings: 'الإعدادات والأتمتة', stats: 'الإحصاءات',
  platform: 'مركز المنصة', accounts: 'إدارة الحسابات', archive: 'الأرشيف', log: 'سجل العمليات',
};

const workspaceMeta = {
  roomchat: ['LIVE ROOM / CHAT', 'شات الروم', 'رسائل الغرفة والترحيب بالحضور من حسابك النشط.'],
  currentroom: ['LIVE ROOM / COMMAND', 'الغرفة الحالية', 'مشاركة الحساب وإدارة المسرح والطابور والحضور من كونسول واحد.'],
  quick: ['LIVE ROOM / QUICK ACTIONS', 'التحكم السريع', 'أوامر التشغيل المتكررة مع فصل واضح للأوامر الخطرة.'],
  effects: ['ENGAGEMENT / BROADCAST', 'تأثيرات', 'بث تأثيرات صوتية وبصرية على الغرفة كلها دفعة واحدة.'],
  queue: ['LIVE ROOM / SPEAK QUEUE', 'طابور التحدث', 'رتّب الطلبات وراقب وقت الانتظار وانقل الأشخاص إلى المسرح.'],
  members: ['LIVE ROOM / STAGE', 'المسرح والجمهور', 'صورة تشغيلية للحضور مع إجراءات فردية وجماعية.'],
  hallway: ['DISCOVERY / LIVE ROOMS', 'الغرف المباشرة', 'اكتشف الغرف النشطة وابدأ مراقبة أي غرفة دون إدخال الحساب إليها.'],
  houses: ['COMMUNITY / HOUSES', 'الهاوسات', 'إدارة العضويات والأعضاء والريبلايز ووصف الهاوس.'],
  messages: ['COMMUNICATION / INBOX', 'الرسائل', 'الطلبات والمحادثات المقروءة من حساب Clubhouse النشط.'],
  social: ['NETWORK / PEOPLE', 'الشبكة الاجتماعية', 'البحث والمتابعون والموجات والاقتراحات والحظر.'],
  friends: ['NETWORK / PRESENCE', 'الأصدقاء والإشعارات', 'مين أونلاين دلوقتي، آخر ظهور رصده Clubhouse mod by Darhous، وتنبيهات قابلة للنقر تاخدك للغرفة فورًا.'],
  profile: ['ACCOUNT / IDENTITY', 'الملف الشخصي', 'معاينة الحساب النشط وبياناته الاجتماعية.'],
  platform: ['SYSTEM / PLATFORM TRUTH', 'مركز المنصة', 'العقود والتشخيص والعمليات المحدودة القابلة للمعاينة والإلغاء.'],
  accounts: ['ACCOUNT / SESSION SHELF', 'إدارة الحسابات', 'تبديل الهوية وإضافة جلسات مؤقتة دون حفظ بيانات الدخول على القرص.'],
  search: ['LIVE ROOM / SEARCH', 'البحث داخل الغرفة', 'اعثر على عضو بالاسم أو اسم المستخدم أو المعرّف.'],
  advanced: ['AUTOMATION / GUARDRAILS', 'الأوامر المتقدمة', 'حماية الغرفة والتنبيهات والسعة والنوبات والمراقبة متعددة الغرف.'],
  settings: ['SYSTEM / AUTOMATION', 'الإعدادات والأتمتة', 'القوائم والسياسات التلقائية والمظهر والنسخ الاحتياطي والاختصارات.'],
  stats: ['ANALYTICS / SESSION', 'إحصاءات الجلسة', 'الحضور والنمو وصحة الغرفة ومقارنة الجلسات.'],
  archive: ['RECORDS / ARCHIVE', 'الأرشيف', 'سجلات الجلسات السابقة وتقاريرها ومسار التدقيق.'],
  log: ['DIAGNOSTICS / API LOG', 'سجل العمليات', 'نداءات API الحية للمتابعة والتشخيص والتصدير.'],
};

document.documentElement.dataset.uiShell = 'initializing';
const focusableSelector = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';
let mobileNavTrigger = null;

function trapFocus(event, container) {
  if (event.key !== 'Tab') return;
  const items = [...container.querySelectorAll(focusableSelector)].filter((item) => item.getClientRects().length && item.getAttribute('aria-hidden') !== 'true');
  if (!items.length) { event.preventDefault(); container.focus?.(); return; }
  const first = items[0];
  const last = items.at(-1);
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}

function setMobileNav(open) {
  if (open) mobileNavTrigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  document.body.classList.toggle('mobile-nav-open', open);
  byId('sidebarScrim').hidden = !open;
  byId('mobileMenuBtn')?.setAttribute('aria-expanded', String(open));
  byId('mobileWorkspaceBtn')?.setAttribute('aria-expanded', String(open));
  if (open) requestAnimationFrame(() => byId('sidebarMobileClose')?.focus());
  else requestAnimationFrame(() => mobileNavTrigger?.focus?.());
}

function installMobileNavigation() {
  byId('mobileMenuBtn')?.addEventListener('click', () => setMobileNav(true));
  byId('mobileWorkspaceBtn')?.addEventListener('click', () => setMobileNav(true));
  byId('sidebarMobileClose')?.addEventListener('click', () => setMobileNav(false));
  byId('sidebarScrim')?.addEventListener('click', () => setMobileNav(false));
  document.addEventListener('keydown', (event) => {
    if (!document.body.classList.contains('mobile-nav-open')) return;
    if (event.key === 'Escape') setMobileNav(false);
    else trapFocus(event, byId('sidebar'));
  });
  document.querySelectorAll('#tabs .nav-item').forEach((button) => button.addEventListener('click', () => {
    if (matchMedia('(max-width: 820px)').matches) setMobileNav(false);
  }));
}

function syncWorkspace(button) {
  const name = button.dataset.tab;
  if (!name) return;
  document.querySelectorAll('.nav-item[data-tab]').forEach((item) => {
    const active = item.dataset.tab === name;
    item.setAttribute('aria-current', active ? 'page' : 'false');
  });
  const breadcrumb = byId('breadcrumbText');
  if (breadcrumb) breadcrumb.textContent = workspaceNames[name] || name;
  announce(`تم فتح مساحة ${workspaceNames[name] || name}`);
  window.dispatchEvent(new CustomEvent('modpanel:workspace', { detail: { name } }));
}

function installWorkspaceState() {
  document.querySelectorAll('.nav-item[data-tab]').forEach((button) => {
    button.addEventListener('click', () => syncWorkspace(button));
  });
  const initial = document.querySelector('.nav-item.active[data-tab]');
  if (initial) syncWorkspace(initial);

  const queueBadge = byId('queueBadge');
  const mobileBadge = byId('mobileQueueBadge');
  if (queueBadge && mobileBadge) {
    const sync = () => {
      mobileBadge.textContent = queueBadge.textContent;
      mobileBadge.hidden = queueBadge.hidden;
    };
    new MutationObserver(sync).observe(queueBadge, { attributes: true, childList: true, characterData: true, subtree: true });
    sync();
  }
}

function installWorkspaceHeadings() {
  for (const [name, [, title, description]] of Object.entries(workspaceMeta)) {
    const panel = byId(`tab-${name}`);
    if (!panel || panel.querySelector(':scope > .workspace-heading')) continue;
    const heading = document.createElement('header');
    heading.className = 'workspace-heading';
    const copy = document.createElement('div');
    const titleNode = document.createElement('h2');
    const descriptionNode = document.createElement('span');
    titleNode.textContent = title;
    descriptionNode.textContent = description;
    copy.append(titleNode, descriptionNode);
    heading.appendChild(copy);
    panel.prepend(heading);
  }
}

// كنية علوية صغيرة (زي "AUTOMATION / GUARDRAILS") فوق عنوان كل تبويب — من نفس بيانات
// workspaceMeta الموجودة أصلاً، بدون أي هيكل HTML جديد لكل تبويب لوحده.
function installWorkspaceEyebrows() {
  for (const [name, [eyebrow]] of Object.entries(workspaceMeta)) {
    if (!eyebrow) continue;
    const panel = byId(`tab-${name}`);
    const h2 = panel?.querySelector(':scope > header h2');
    if (!h2 || h2.parentElement.querySelector(':scope > .workspace-eyebrow')) continue;
    const tag = document.createElement('small');
    tag.className = 'workspace-eyebrow';
    tag.textContent = eyebrow;
    h2.parentElement.insertBefore(tag, h2);
  }
}

function applyProfessionalCopy() {
  const textById = {
    backToHallwayBtn: 'الغرف المباشرة — مع إبقاء المراقبة', copyRoomSummaryBtn: 'نسخ ملخص الغرفة', shareRoomBtn: 'نسخ رابط الغرفة',
    panicBtn: 'وضع الطوارئ — قفل الطلبات وكتم المسرح وطرد المحظورين', inviteNextNBtn: 'دعوة أول عدد من الطابور',
    muteNonModsBtn: 'كتم المتحدثين غير المودريتورز', copyAttendeesBtn: 'نسخ قائمة الحضور',
    inviteAllListenersBtn: 'دعوة كل الجمهور إلى المسرح', inviteAllVipBtn: 'دعوة أعضاء VIP الحاضرين',
    kickAllBlacklistedBtn: 'طرد المحظورين الحاضرين', leaveChannelBtn: 'مغادرة الغرفة فعليًا',
    inviteQueueExceptBtn: 'دعوة الباقين بعد الاستثناء', restoreQueueBackupBtn: 'استعادة آخر نسخة ودعوتها',
    exportMembersCsvBtn: 'تصدير CSV', clearLogBtn: 'مسح السجل', exportLogBtn: 'تصدير السجل',
  };
  for (const [id, label] of Object.entries(textById)) {
    const control = byId(id);
    if (!control) continue;
    const existingIcon = control.querySelector(':scope > svg');
    control.replaceChildren(...(existingIcon ? [existingIcon] : []), document.createTextNode(label));
  }
  const cardTitles = {
    muteAllBtn: ['كتم كل المتحدثين', 'يستثني من تحميهم الإعدادات'],
    inviteAllBtn: ['دعوة كل الطابور', 'إرسال دعوات التحدث الحالية'],
    lowerAllBtn: ['نقل المتحدثين إلى الجمهور', 'أمر جماعي ذو تأثير مباشر'],
    reactAllBtn: ['تفاعل جماعي', 'إرسال قيمة واحدة لكل الحاضرين'],
    reactCurrentBtn: ['تفاعل للمتحدث الحالي', 'تحديد تقريبي حسب نشاط الغرفة'],
  };
  for (const [id, [title, sub]] of Object.entries(cardTitles)) {
    const card = byId(id);
    if (!card) continue;
    const titleNode = card.querySelector('.action-title');
    const subNode = card.querySelector('.action-sub');
    if (titleNode) titleNode.textContent = title;
    if (subNode) subNode.textContent = sub;
  }
}

function installRoomMonitorForm() {
  byId('roomMonitorForm')?.addEventListener('submit', (event) => {
    event.preventDefault();
    byId('connectBtn')?.click();
  });
}

function installSecretField() {
  const input = byId('tokenLoginInput');
  const button = byId('tokenRevealBtn');
  if (!input || !button) return;
  button.addEventListener('click', () => {
    const reveal = input.type === 'password';
    input.type = reveal ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(reveal));
    button.setAttribute('aria-label', reveal ? 'إخفاء التوكين' : 'إظهار التوكين');
    input.focus();
  });
}

function installLegacyModalA11y() {
  const triggers = new WeakMap();
  const backdrops = [...document.querySelectorAll('.modal-backdrop, .palette-backdrop')];
  backdrops.forEach((backdrop) => {
    const panel = backdrop.querySelector('.modal, .palette');
    if (!panel) return;
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    panel.setAttribute('tabindex', '-1');
    const observer = new MutationObserver(() => {
      if (!backdrop.hidden) {
        triggers.set(backdrop, document.activeElement instanceof HTMLElement ? document.activeElement : null);
        requestAnimationFrame(() => (backdrop.querySelector('input,button,select,textarea,[tabindex="0"]') || panel).focus());
      } else {
        requestAnimationFrame(() => triggers.get(backdrop)?.focus?.());
      }
    });
    observer.observe(backdrop, { attributes: true, attributeFilter: ['hidden'] });
  });
  document.addEventListener('keydown', (event) => {
    const open = backdrops.find((item) => !item.hidden);
    if (!open) return;
    if (event.key === 'Tab') { trapFocus(event, open); return; }
    if (event.key !== 'Escape') return;
    const close = open.querySelector('[id$="Close"], [id$="close"], [id$="CloseBtn"], [id$="reactionClose"]');
    if (close) close.click(); else open.hidden = true;
  });
}

function installTabSemantics() {
  document.querySelectorAll('.chat-loc-toggle').forEach((group) => {
    group.setAttribute('role', 'tablist');
    group.querySelectorAll('button').forEach((tab) => {
      tab.setAttribute('role', 'tab');
      tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
      tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');
      tab.addEventListener('click', () => {
        group.querySelectorAll('[role="tab"]').forEach((item) => {
          item.setAttribute('aria-selected', String(item === tab));
          item.setAttribute('tabindex', item === tab ? '0' : '-1');
        });
      });
      tab.addEventListener('keydown', (event) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
        const tabs = [...group.querySelectorAll('[role="tab"]')];
        const current = tabs.indexOf(tab);
        const target = event.key === 'Home' ? tabs[0] : event.key === 'End' ? tabs.at(-1) : tabs[(current + (event.key === 'ArrowLeft' ? -1 : 1) + tabs.length) % tabs.length];
        event.preventDefault(); target.focus(); target.click();
      });
    });
  });
  const houseTabs = document.querySelectorAll('#houseDetailPanel [data-hview]');
  houseTabs.forEach((tab) => {
    tab.setAttribute('role', 'tab');
    tab.setAttribute('aria-selected', String(tab.classList.contains('active')));
    tab.setAttribute('tabindex', tab.classList.contains('active') ? '0' : '-1');
    tab.addEventListener('click', () => houseTabs.forEach((item) => {
      item.setAttribute('aria-selected', String(item === tab));
      item.setAttribute('tabindex', item === tab ? '0' : '-1');
    }));
  });
}

function labelUnlabelledControls(root = document) {
  root.querySelectorAll('input, select, textarea').forEach((control) => {
    if (control.labels?.length || control.getAttribute('aria-label') || control.getAttribute('aria-labelledby')) return;
    const label = control.placeholder || control.title || control.name || control.id?.replace(/([a-z])([A-Z])/g, '$1 $2');
    if (label) control.setAttribute('aria-label', label);
  });
  root.querySelectorAll('button').forEach((button) => {
    if (button.getAttribute('aria-label') || button.textContent.trim()) return;
    if (button.title) button.setAttribute('aria-label', button.title);
  });
}

function installDisclosureState() {
  byId('toastHistoryBtn')?.addEventListener('click', () => {
    requestAnimationFrame(() => byId('toastHistoryBtn')?.setAttribute('aria-expanded', String(!byId('historyDrawer')?.hidden)));
  });
  const collapseObserver = new MutationObserver((records) => {
    for (const record of records) {
      const card = record.target;
      const button = card.querySelector(':scope > .card-head .collapse-toggle');
      if (!button) continue;
      button.setAttribute('aria-expanded', String(!card.classList.contains('collapsed')));
      button.setAttribute('aria-label', card.classList.contains('collapsed') ? 'فتح القسم' : 'طي القسم');
      if (!button.querySelector('svg')) button.replaceChildren(icon(card.classList.contains('collapsed') ? 'down' : 'control'));
    }
  });
  document.querySelectorAll('.card').forEach((card) => collapseObserver.observe(card, { attributes: true, attributeFilter: ['class'] }));
}

function monitorDynamicContent() {
  const observer = new MutationObserver((records) => {
    const roots = new Set(records.map((record) => record.target instanceof Element ? record.target : record.target.parentElement).filter(Boolean));
    roots.forEach((root) => {
      labelUnlabelledControls(root);
      applyDynamicIcons(root);
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
}

window.ModPanelUI = Object.freeze({ confirmAction, inputAction, icon, announce });
applyStaticIcons();
applyDynamicIcons();
installDialogDismissal();
installMobileNavigation();
installWorkspaceState();
installWorkspaceHeadings();
installWorkspaceEyebrows();
applyProfessionalCopy();
installRoomMonitorForm();
installSecretField();
installLegacyModalA11y();
installTabSemantics();
installDisclosureState();
labelUnlabelledControls();
monitorDynamicContent();
document.documentElement.dataset.uiShell = 'ready';
