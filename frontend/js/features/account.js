import { $ } from '../utils.js';

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function showStatus(message, type = '') {
  const status = $('#register-status');
  status.textContent = message;
  status.className = `form-status ${type}`.trim();
}

function validate(email, password, confirmation) {
  if (!emailPattern.test(email) || email.length > 254) return 'Ange en giltig e-postadress.';
  if (password.length < 8 || password.length > 128) return 'Lösenordet måste vara mellan 8 och 128 tecken.';
  if (!/[A-Za-zÅÄÖåäö]/.test(password) || !/\d/.test(password)) return 'Lösenordet måste innehålla både bokstav och siffra.';
  if (password !== confirmation) return 'Lösenorden matchar inte.';
  return '';
}

export function initAccount() {
  const form = $('#register-form');
  const submit = $('#register-submit');

  form.addEventListener('submit', async event => {
    event.preventDefault();
    const email = $('#register-email').value.trim();
    const password = $('#register-password').value;
    const passwordConfirmation = $('#register-password-confirmation').value;
    const problem = validate(email, password, passwordConfirmation);
    if (problem) {
      showStatus(problem, 'error');
      return;
    }

    submit.disabled = true;
    submit.textContent = 'Skapar konto…';
    showStatus('Registreringen pågår…');

    try {
      const response = await fetch('/api/accounts/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, passwordConfirmation }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message || 'Kontot kunde inte skapas.');
      form.reset();
      showStatus(`Kontot för ${body.user.email} är skapat.`, 'success');
    } catch (error) {
      showStatus(error.message || 'Kontot kunde inte skapas.', 'error');
    } finally {
      submit.disabled = false;
      submit.textContent = 'Skapa konto';
    }
  });
}
