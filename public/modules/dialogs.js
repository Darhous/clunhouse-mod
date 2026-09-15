import { announce, byId } from './dom.js';

let lastFocused = null;

function openDialog(dialog) {
  lastFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
}

function restoreFocus() {
  requestAnimationFrame(() => lastFocused?.focus?.());
}

export function confirmAction({
  title = 'هل تريد المتابعة؟',
  description = '',
  target = '',
  result = '',
  confirmLabel = 'تأكيد الإجراء',
  tone = 'danger',
} = {}) {
  const dialog = byId('actionDialog');
  if (!dialog) return Promise.resolve(false);
  byId('actionDialogTitle').textContent = title;
  byId('actionDialogDescription').textContent = description;
  byId('actionDialogTarget').textContent = target;
  byId('actionDialogResult').textContent = result;
  byId('actionDialogImpact').hidden = !(target || result);
  const confirm = byId('actionDialogConfirm');
  confirm.textContent = confirmLabel;
  confirm.className = tone === 'warning' ? 'btn btn--warning' : tone === 'neutral' ? 'btn btn--accent' : 'btn btn--danger';

  openDialog(dialog);
  requestAnimationFrame(() => confirm.focus());
  return new Promise((resolve) => {
    const done = () => {
      dialog.removeEventListener('close', done);
      const accepted = dialog.returnValue === 'confirm';
      announce(accepted ? 'تم تأكيد الإجراء' : 'تم إلغاء الإجراء');
      restoreFocus();
      resolve(accepted);
    };
    dialog.addEventListener('close', done);
  });
}

export function inputAction({
  title = 'أدخل القيمة',
  description = '',
  label = 'القيمة',
  value = '',
  placeholder = '',
} = {}) {
  const dialog = byId('inputDialog');
  const input = byId('inputDialogValue');
  if (!dialog || !input) return Promise.resolve(null);
  byId('inputDialogTitle').textContent = title;
  byId('inputDialogDescription').textContent = description;
  byId('inputDialogLabel').textContent = label;
  input.value = value;
  input.placeholder = placeholder;
  openDialog(dialog);
  requestAnimationFrame(() => { input.focus(); input.select(); });

  return new Promise((resolve) => {
    const done = () => {
      dialog.removeEventListener('close', done);
      const result = dialog.returnValue === 'confirm' ? input.value : null;
      restoreFocus();
      resolve(result);
    };
    dialog.addEventListener('close', done);
  });
}

export function installDialogDismissal() {
  document.querySelectorAll('dialog').forEach((dialog) => {
    dialog.querySelector('[data-dialog-cancel]')?.addEventListener('click', () => dialog.close('cancel'));
    dialog.addEventListener('click', (event) => {
      if (event.target === dialog) dialog.close('cancel');
    });
  });
}
