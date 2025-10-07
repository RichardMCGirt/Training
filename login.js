  const email = document.getElementById('email');
  const password = document.getElementById('password');
  const msg = document.getElementById('msg');
  const btn = document.getElementById('btnLogin');

  const VANIR_DOMAIN = 'vanirinstalledsales.com';
  const ADMIN_EMAIL = 'diana.smith@vanirinstalledsales.com';

  // Prefill email if remembered
  const saved = localStorage.getItem('trainingEmail') || localStorage.getItem('authEmail');
  if (saved) email.value = saved;

  // Decide where to send the user after login
  function getRedirectForEmail(e) {
    const em = String(e || '').trim().toLowerCase();
    if (em === ADMIN_EMAIL) return './admin.html';
    return './dashboard.html';
  }

  function autocompleteDomain(force = false) {
    const val = email.value.trim();
    if (!val) return;

    // If no '@' and not forcing, do nothing (user might still be typing the local part)
    if (!val.includes('@') && !force) return;

    const [local, domainRaw = ''] = val.split('@');
    const domain = domainRaw.toLowerCase();

    // If user just typed '@' or a partial domain, or a different domain → normalize
    if (domain === '' || domain === VANIR_DOMAIN) {
      // empty or already correct → set to proper full if empty
      if (domain === '') {
        email.value = `${local}@${VANIR_DOMAIN}`;
      } else {
        // Already correct domain: ensure casing normalized
        email.value = `${local}@${VANIR_DOMAIN}`;
      }
      return;
    }

    // Different domain typed → replace with the target domain
    email.value = `${local}@${VANIR_DOMAIN}`;
  }

  // When user presses '@', immediately complete domain
  email.addEventListener('keydown', (ev) => {
    if (ev.key === '@') {
      // Let the '@' be inserted first, then complete domain on next tick
      setTimeout(() => autocompleteDomain(true), 0);
    }
  });

  // As user types, if they have '@' with no dot in domain yet, gently complete it
  email.addEventListener('input', () => {
    const v = email.value;
    if (v.includes('@')) {
      const domainPart = v.split('@')[1] || '';
      // If domain missing a dot (likely incomplete) or is wrong, normalize
      if (!domainPart.includes('.') || domainPart.toLowerCase() !== VANIR_DOMAIN) {
        autocompleteDomain();
      }
    }
  });

  // On blur, force normalization if they typed any '@' at all
  email.addEventListener('blur', () => autocompleteDomain(true));

  async function handleLogin() {
    try {
      const em = email.value.trim().toLowerCase();
      const pw = password.value;

      // Final safety: normalize email before sending
      autocompleteDomain(true);

      msg.textContent = 'Logging in…';
      btn.disabled = true;

      await loginWithEmailPassword(em, pw);

      // Persist the email for next time
      localStorage.setItem('authEmail', em);

      msg.textContent = 'Success! Redirecting…';
      window.location.href = getRedirectForEmail(em);
    } catch (e) {
      msg.textContent = e?.message || 'Login failed';
    } finally {
      btn.disabled = false;
    }
  }

  // Click to login
  btn.addEventListener('click', handleLogin);

  // Allow Enter to submit from password field
  password.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') handleLogin();
  });
