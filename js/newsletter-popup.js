/* ============================================================
   HeyVino Newsletter Popup
   Self-contained: injects its own styles and markup.
   Include on any page with:
     <script src="/js/newsletter-popup.js" defer></script>

   Behavior: opens once per browsing session, after 9 seconds OR
   40% scroll depth, whichever comes first. Dismissing hides it for
   the session. Subscribing hides it permanently.
   Manual trigger: window.HeyVinoNewsletter.open()
   ============================================================ */
(function () {
  'use strict';

  if (window.HeyVinoNewsletter) return; // guard against double-inclusion

  var SESSION_KEY = 'hv_nl_seen';
  var SUBSCRIBED_KEY = 'hv_nl_subscribed';
  var DELAY_MS = 9000;
  var SCROLL_TRIGGER = 0.4;
  var ENDPOINT = '/api/subscribe';

  var CSS = [
    '.hv-nl-overlay{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;padding:20px;background:rgba(26,18,8,.55);-webkit-backdrop-filter:blur(3px);backdrop-filter:blur(3px);opacity:0;visibility:hidden;transition:opacity 260ms ease,visibility 260ms}',
    '.hv-nl-overlay.hv-nl-open{opacity:1;visibility:visible}',
    '.hv-nl-card{position:relative;width:100%;max-width:420px;background:#FFF8E8;border-radius:14px;overflow:hidden;box-shadow:0 24px 60px rgba(26,18,8,.32);transform:translateY(14px) scale(.97);transition:transform 300ms cubic-bezier(.22,1,.36,1);font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;text-align:left}',
    '.hv-nl-overlay.hv-nl-open .hv-nl-card{transform:translateY(0) scale(1)}',
    '.hv-nl-head{position:relative;background:#6B1E2A;padding:26px 28px 22px;text-align:center;overflow:hidden}',
    '.hv-nl-vine{position:absolute;top:-6px;width:74px;height:74px;color:#C9A84C;opacity:.28;pointer-events:none}',
    '.hv-nl-vine-l{left:-10px}',
    '.hv-nl-vine-r{right:-10px;transform:scaleX(-1)}',
    '.hv-nl-eyebrow{position:relative;margin:0 0 8px;font-size:.68rem;font-weight:600;letter-spacing:.16em;text-transform:uppercase;color:#C9A84C}',
    '.hv-nl-title{position:relative;margin:0;font-size:1.42rem;line-height:1.25;font-weight:700;color:#FFF8E8}',
    '.hv-nl-title em{font-style:italic;color:#C9A84C}',
    '.hv-nl-body{padding:22px 28px 26px}',
    '.hv-nl-copy{margin:0 0 18px;font-size:.92rem;line-height:1.55;color:#7A6E64;text-align:center}',
    '.hv-nl-copy strong{color:#1A1208;font-weight:600}',
    '.hv-nl-field{display:flex;flex-direction:column;gap:9px}',
    '.hv-nl-overlay .hv-nl-input{width:100%;box-sizing:border-box;height:auto;margin:0;padding:12px 14px;font:inherit;font-size:.94rem;line-height:1.3;color:#1A1208;background:#fff;border:1px solid #E8E0D4;border-radius:8px;box-shadow:none;-webkit-appearance:none;appearance:none;transition:border-color 160ms ease,box-shadow 160ms ease}',
    '.hv-nl-overlay .hv-nl-input::placeholder{color:#B3A79C}',
    '.hv-nl-overlay .hv-nl-input:focus{outline:none;border-color:#6B1E2A;box-shadow:0 0 0 3px rgba(107,30,42,.13)}',
    '.hv-nl-overlay .hv-nl-input.hv-nl-invalid{border-color:#A32B36}',
    '.hv-nl-overlay .hv-nl-submit{width:100%;box-sizing:border-box;margin:0;padding:12px 18px;font:inherit;font-size:.94rem;font-weight:600;line-height:1.2;color:#FFF8E8;background:#6B1E2A;border:0;border-radius:8px;box-shadow:none;cursor:pointer;-webkit-appearance:none;appearance:none;transition:background 160ms ease,transform 120ms ease}',
    '.hv-nl-overlay .hv-nl-submit:hover{background:#581822}',
    '.hv-nl-overlay .hv-nl-submit:active{transform:translateY(1px)}',
    '.hv-nl-overlay .hv-nl-submit:disabled{opacity:.65;cursor:default}',
    '.hv-nl-note{margin:14px 0 0;font-size:.76rem;line-height:1.5;color:#9A8F84;text-align:center}',
    '.hv-nl-error{margin:9px 0 0;font-size:.8rem;color:#A32B36;text-align:center;min-height:1em}',
    '.hv-nl-overlay .hv-nl-decline{display:block;width:auto;margin:12px auto 0;padding:4px;font:inherit;font-size:.8rem;color:#9A8F84;background:none;border:0;border-radius:0;box-shadow:none;cursor:pointer;-webkit-appearance:none;appearance:none;text-decoration:underline;text-underline-offset:2px}',
    '.hv-nl-overlay .hv-nl-decline:hover{color:#6B1E2A}',
    '.hv-nl-overlay .hv-nl-close{position:absolute;top:10px;right:10px;width:30px;height:30px;min-width:0;max-width:none;margin:0;padding:0;display:flex;align-items:center;justify-content:center;color:#FFF8E8;background:rgba(255,248,232,.14);border:0;border-radius:50%;box-shadow:none;cursor:pointer;-webkit-appearance:none;appearance:none;transition:background 160ms ease}',
    '.hv-nl-overlay .hv-nl-close:hover{background:rgba(255,248,232,.3)}',
    '.hv-nl-overlay .hv-nl-close svg{display:block;width:12px;height:12px}',
    '.hv-nl-done{display:none;padding:30px 28px 34px;text-align:center}',
    '.hv-nl-card.hv-nl-subscribed .hv-nl-body{display:none}',
    '.hv-nl-card.hv-nl-subscribed .hv-nl-done{display:block}',
    '.hv-nl-done-mark{width:42px;height:42px;margin:0 auto 14px;display:grid;place-items:center;color:#6B1E2A;background:rgba(201,168,76,.2);border-radius:50%;font-size:20px}',
    '.hv-nl-done h3{margin:0 0 7px;font-size:1.05rem;color:#1A1208}',
    '.hv-nl-done p{margin:0;font-size:.88rem;line-height:1.55;color:#7A6E64}',
    '.hv-nl-overlay :focus-visible{outline:2px solid #C9A84C;outline-offset:2px}',
    '.hv-nl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}',
    '@media (max-width:420px){.hv-nl-head{padding:22px 20px 18px}.hv-nl-body{padding:20px 20px 24px}.hv-nl-title{font-size:1.26rem}}',
    '@media (prefers-reduced-motion:reduce){.hv-nl-overlay,.hv-nl-card{transition:none}.hv-nl-card{transform:none}}'
  ].join('');

  var VINE = '<path d="M8 2c6 8 6 16 2 24" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>' +
             '<path d="M10 12c6 1 10 5 11 11" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>' +
             '<circle cx="9" cy="30" r="4.2" fill="currentColor"/><circle cx="18" cy="33" r="4.2" fill="currentColor"/>' +
             '<circle cx="13" cy="39" r="4.2" fill="currentColor"/><circle cx="22" cy="42" r="4.2" fill="currentColor"/>' +
             '<circle cx="17" cy="48" r="4.2" fill="currentColor"/>';

  var HTML =
    '<div class="hv-nl-card" id="hvNlCard">' +
      '<div class="hv-nl-head">' +
        '<svg class="hv-nl-vine hv-nl-vine-l" viewBox="0 0 60 60" fill="none" aria-hidden="true">' + VINE + '</svg>' +
        '<svg class="hv-nl-vine hv-nl-vine-r" viewBox="0 0 60 60" fill="none" aria-hidden="true">' + VINE + '</svg>' +
        '<button class="hv-nl-close" type="button" id="hvNlClose" aria-label="Close">' +
          '<svg viewBox="0 0 12 12" fill="none" aria-hidden="true">' +
            '<path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>' +
          '</svg>' +
        '</button>' +
        '<p class="hv-nl-eyebrow">HeyVino Weekly</p>' +
        '<h2 class="hv-nl-title" id="hvNlTitle">Get the codes <em>before</em> they expire</h2>' +
      '</div>' +
      '<div class="hv-nl-body">' +
        '<p class="hv-nl-copy" id="hvNlCopy">One short email every Sunday with the week\'s best promo codes from <strong>600+ wineries</strong>. Free, and easy to leave.</p>' +
        '<div class="hv-nl-field">' +
          '<label class="hv-nl-sr" for="hvNlEmail">Email address</label>' +
          '<input class="hv-nl-input" id="hvNlEmail" type="email" name="email" inputmode="email" autocomplete="email" placeholder="you@example.com" required>' +
          '<button class="hv-nl-submit" type="button" id="hvNlSubmit">Subscribe</button>' +
        '</div>' +
        '<p class="hv-nl-error" id="hvNlError" role="alert"></p>' +
        '<p class="hv-nl-note">Codes only. Unsubscribe anytime.</p>' +
        '<button class="hv-nl-decline" type="button" id="hvNlDecline">No thanks, I\'ll browse</button>' +
      '</div>' +
      '<div class="hv-nl-done">' +
        '<div class="hv-nl-done-mark">&#10003;</div>' +
        '<h3>You\'re on the list</h3>' +
        '<p>Your first roundup lands this Sunday. Cheers.</p>' +
      '</div>' +
    '</div>';

  function readFlag(store, key) {
    try { return window[store].getItem(key) === '1'; } catch (e) { return false; }
  }
  function writeFlag(store, key) {
    try { window[store].setItem(key, '1'); } catch (e) {}
  }

  var overlay, card, emailEl, submitEl, errorEl, lastFocus = null, armed = true, built = false;

  function build() {
    if (built) return;
    built = true;

    var style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);

    overlay = document.createElement('div');
    overlay.className = 'hv-nl-overlay';
    overlay.id = 'hvNewsletter';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-labelledby', 'hvNlTitle');
    overlay.setAttribute('aria-describedby', 'hvNlCopy');
    overlay.hidden = true;
    overlay.innerHTML = HTML;
    document.body.appendChild(overlay);

    card = document.getElementById('hvNlCard');
    emailEl = document.getElementById('hvNlEmail');
    submitEl = document.getElementById('hvNlSubmit');
    errorEl = document.getElementById('hvNlError');

    document.getElementById('hvNlClose').addEventListener('click', close);
    document.getElementById('hvNlDecline').addEventListener('click', close);
    submitEl.addEventListener('click', subscribe);
    emailEl.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); subscribe(); }
    });
    overlay.addEventListener('mousedown', function (e) {
      if (e.target === overlay) close();
    });
  }

  function open() {
    build();
    if (overlay.classList.contains('hv-nl-open')) return;
    lastFocus = document.activeElement;
    overlay.hidden = false;
    requestAnimationFrame(function () { overlay.classList.add('hv-nl-open'); });
    writeFlag('sessionStorage', SESSION_KEY);
    setTimeout(function () { emailEl.focus(); }, 320);
    document.addEventListener('keydown', onKeydown);
  }

  function close() {
    if (!overlay) return;
    overlay.classList.remove('hv-nl-open');
    document.removeEventListener('keydown', onKeydown);
    setTimeout(function () { overlay.hidden = true; }, 280);
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  function onKeydown(e) {
    if (e.key === 'Escape') { close(); return; }
    if (e.key !== 'Tab') return;
    var items = card.querySelectorAll('button, input, [href]');
    var list = [];
    for (var i = 0; i < items.length; i++) {
      if (items[i].offsetParent !== null && !items[i].disabled) list.push(items[i]);
    }
    if (!list.length) return;
    var first = list[0], last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  function validEmail(v) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);
  }

  function subscribe() {
    var value = emailEl.value.trim();
    errorEl.textContent = '';
    emailEl.classList.remove('hv-nl-invalid');

    if (!validEmail(value)) {
      emailEl.classList.add('hv-nl-invalid');
      errorEl.textContent = 'Enter a valid email address.';
      emailEl.focus();
      return;
    }

    submitEl.disabled = true;
    submitEl.textContent = 'Subscribing...';

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: value })
    })
      .then(function (res) {
        if (!res.ok) throw new Error('Request failed');
        writeFlag('localStorage', SUBSCRIBED_KEY);
        card.classList.add('hv-nl-subscribed');
        setTimeout(close, 2600);
      })
      .catch(function () {
        submitEl.disabled = false;
        submitEl.textContent = 'Subscribe';
        errorEl.textContent = 'That did not go through. Try again in a moment.';
      });
  }

  function trigger() {
    if (!armed) return;
    armed = false;
    window.removeEventListener('scroll', onScroll);
    open();
  }

  function onScroll() {
    var max = document.body.scrollHeight - window.innerHeight;
    if (max > 0 && window.scrollY / max >= SCROLL_TRIGGER) trigger();
  }

  window.HeyVinoNewsletter = {
    open: function () { armed = false; open(); },
    close: close
  };

  if (!readFlag('localStorage', SUBSCRIBED_KEY) && !readFlag('sessionStorage', SESSION_KEY)) {
    setTimeout(trigger, DELAY_MS);
    window.addEventListener('scroll', onScroll, { passive: true });
  }
})();

