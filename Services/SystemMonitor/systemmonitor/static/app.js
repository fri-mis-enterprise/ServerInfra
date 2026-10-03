(() => {
  'use strict';
  const clock = document.querySelector('[data-server-time]');
  if (clock) {
    const time = document.getElementById('system-time');
    const note = document.getElementById('clock-status');
    const format = new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Manila', day: '2-digit', month: 'short', year: 'numeric',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true
    });
    let serverMs = Date.parse(clock.dataset.serverTime);
    let sampledAt = performance.now();
    let syncing = false;
    const paint = () => {
      const now = new Date(serverMs + performance.now() - sampledAt);
      time.textContent = format.format(now);
      time.dateTime = now.toISOString();
    };
    const sync = async () => {
      if (syncing) return;
      syncing = true;
      const start = performance.now();
      try {
        const response = await fetch(clock.dataset.timeUrl, {
          cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.timeout(8000)
        });
        if (!response.ok) throw new Error('Time update unavailable');
        const data = await response.json();
        const parsed = Date.parse(data.server_time);
        if (!Number.isFinite(parsed)) throw new Error('Invalid server time');
        const end = performance.now();
        serverMs = parsed + (end - start) / 2;
        sampledAt = end;
        note.textContent = 'All deadlines follow this clock';
        note.classList.remove('clock-warning');
        paint();
      } catch (_) {
        note.textContent = 'Time update unavailable · last sync retained';
        note.classList.add('clock-warning');
      } finally {
        syncing = false;
      }
    };
    paint();
    sync();
    window.setInterval(paint, 1000);
    window.setInterval(sync, 60000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) sync();
    });
  }

  const dialog = document.getElementById('close-dialog');
  document.addEventListener('click', event => {
    const copy = event.target.closest('[data-copy-invitation]');
    if (copy) {
      const input = document.getElementById('invitation-link');
      input.select();
      if (navigator.clipboard && window.isSecureContext) {
        navigator.clipboard.writeText(input.value).then(() => { copy.textContent = 'Copied'; })
          .catch(() => { copy.textContent = 'Selected — press Ctrl+C'; });
      } else {
        copy.textContent = 'Selected — press Ctrl+C';
      }
    }
    const toggle = event.target.closest('[data-password-toggle]');
    if (toggle) {
      const input = document.getElementById(toggle.dataset.passwordToggle);
      const showing = input.type === 'password';
      input.type = showing ? 'text' : 'password';
      toggle.textContent = showing ? 'Hide' : 'Show';
      toggle.setAttribute('aria-pressed', String(showing));
      toggle.setAttribute('aria-label', showing ? 'Hide password' : 'Show password');
    }
    const dismiss = event.target.closest('.dismiss-notice');
    if (dismiss) dismiss.closest('.notice').remove();
    if (event.target.closest('[data-dialog-cancel]') && dialog) dialog.close();
  });
  document.addEventListener('submit', event => {
    const form = event.target;
    if (form.matches('.row-action') && dialog && typeof dialog.showModal === 'function') {
      event.preventDefault();
      document.getElementById('close-app-name').textContent = form.dataset.app;
      document.getElementById('close-month-name').textContent = form.dataset.month;
      const confirmation = document.getElementById('confirm-close-form');
      confirmation.action = form.action;
      confirmation.elements.csrf.value = form.elements.csrf.value;
      dialog.showModal();
      dialog.querySelector('[data-dialog-cancel]').focus();
      return;
    }
    if (form.id === 'open-form' && !form.querySelector('input[name="months"]:checked')) {
      event.preventDefault();
      document.getElementById('month-error').hidden = false;
      form.querySelector('input[name="months"]').focus();
      return;
    }
    if (form.id === 'open-form' || form.id === 'confirm-close-form') {
      const button = form.querySelector('button[type="submit"]');
      button.disabled = true;
      button.textContent = form.id === 'open-form' ? 'Opening months…' : 'Closing month…';
    }
  });
  document.addEventListener('htmx:beforeRequest', event => {
    if (dialog && dialog.open && event.detail.elt.id === 'status') event.preventDefault();
  });

  const form = document.getElementById('open-form');
  if (form) {
    const update = () => {
      const selected = [...form.querySelectorAll('input[name="months"]:checked')];
      document.getElementById('selection-count').textContent = selected.length ?
        `${selected.length} month${selected.length === 1 ? '' : 's'} selected` : 'No months selected';
      document.getElementById('summary-app').textContent = form.elements.app.value;
      document.getElementById('summary-year').textContent = form.elements.year.value;
      document.getElementById('summary-months').textContent = selected.length ?
        selected.map(input => input.nextElementSibling.textContent).join(', ') : 'Choose your months';
      const close = form.elements.close_at.value;
      if (close) {
        const date = new Date(close + ':00+08:00');
        if (!Number.isNaN(date.getTime())) document.getElementById('summary-close').textContent =
          new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Manila', day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true }).format(date);
      }
      if (selected.length) document.getElementById('month-error').hidden = true;
    };
    form.addEventListener('input', update);
    form.addEventListener('change', update);
    update();
  }
  window.addEventListener('pageshow', event => {
    if (event.persisted) window.location.reload();
  });
})();
