import { signUp, signIn, getSession, sendVerificationEmail, verifyEmail } from './auth-client.js';

const tabs = {
  signin: document.getElementById('tab-signin'),
  signup: document.getElementById('tab-signup'),
};
const panels = {
  signin: document.getElementById('panel-signin'),
  signup: document.getElementById('panel-signup'),
};
const forms = {
  signin: document.getElementById('signin-form'),
  signup: document.getElementById('signup-form'),
  verify: document.getElementById('verify-form'),
};
const submitButtons = {
  signin: document.getElementById('signin-submit'),
  signup: document.getElementById('signup-submit'),
  verify: document.getElementById('verify-submit'),
};
const errors = {
  signin: document.getElementById('signin-error'),
  signup: document.getElementById('signup-error'),
  verify: document.getElementById('verify-error'),
};
const steps = {
  credentials: document.getElementById('auth-step-credentials'),
  verify: document.getElementById('auth-step-verify'),
  success: document.getElementById('auth-step-success'),
};
const verifyEmailDisplay = document.getElementById('verify-email-display');
const backButton = document.getElementById('back-to-credentials');
const resendButton = document.getElementById('resend-code');

let currentMode = 'signin';
let pendingEmail = '';
let pendingPassword = '';
let pendingName = '';
let isProcessing = false;

function showTab(mode) {
  currentMode = mode;
  Object.keys(tabs).forEach(key => {
    const isActive = key === mode;
    tabs[key].setAttribute('aria-selected', isActive);
    tabs[key].setAttribute('tabindex', isActive ? '0' : '-1');
    panels[key].hidden = !isActive;
  });
  clearErrors();
}

function showStep(step) {
  Object.values(steps).forEach(s => s.classList.add('hidden'));
  steps[step].classList.remove('hidden');
}

function setButtonLoading(button, loading) {
  const text = button.querySelector('.button-text');
  const loader = button.querySelector('.button-loading');
  if (loading) {
    text.classList.add('hidden');
    loader.classList.remove('hidden');
    button.disabled = true;
  } else {
    text.classList.remove('hidden');
    loader.classList.add('hidden');
    button.disabled = false;
  }
}

function setError(element, message) {
  element.textContent = message;
  element.style.display = message ? 'block' : 'none';
}

function clearErrors() {
  Object.values(errors).forEach(e => { e.textContent = ''; e.style.display = 'none'; });
  document.querySelectorAll('.form-error').forEach(e => { e.textContent = ''; });
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validateForm(formId) {
  const form = forms[formId];
  const submitBtn = submitButtons[formId];
  let valid = true;

  const inputs = form.querySelectorAll('input[required]');
  inputs.forEach(input => {
    const errorEl = document.getElementById(`${input.id}-error`);
    if (!input.value.trim()) {
      valid = false;
      if (errorEl) errorEl.textContent = 'This field is required';
    } else if (input.type === 'email' && !validateEmail(input.value)) {
      valid = false;
      if (errorEl) errorEl.textContent = 'Enter a valid email address';
    } else if (input.id === 'signup-password' && input.value.length < 8) {
      valid = false;
      if (errorEl) errorEl.textContent = 'Password must be at least 8 characters';
    } else if (input.id === 'verify-code' && !/^\d{6}$/.test(input.value)) {
      valid = false;
      if (errorEl) errorEl.textContent = 'Enter the 6-digit code';
    } else {
      if (errorEl) errorEl.textContent = '';
    }
  });

  submitBtn.disabled = !valid || isProcessing;
  return valid;
}

async function handleSignIn(event) {
  event.preventDefault();
  if (isProcessing || !validateForm('signin')) return;

  isProcessing = true;
  setButtonLoading(submitButtons.signin, true);
  clearErrors();

  const email = document.getElementById('signin-email').value.trim();
  const password = document.getElementById('signin-password').value;

  try {
    const data = await signIn(email, password);
    if (data?.session?.token) {
      // Already signed in (session exists)
      showSuccessAndRedirect();
    } else if (data?.user) {
      // Needs verification code
      pendingEmail = email;
      pendingPassword = password;
      showVerifyStep(email);
    }
  } catch (err) {
    setError(errors.signin, err.message || 'Sign in failed. Please try again.');
  } finally {
    isProcessing = false;
    setButtonLoading(submitButtons.signin, false);
    validateForm('signin');
  }
}

async function handleSignUp(event) {
  event.preventDefault();
  if (isProcessing || !validateForm('signup')) return;

  isProcessing = true;
  setButtonLoading(submitButtons.signup, true);
  clearErrors();

  const name = document.getElementById('signup-name').value.trim();
  const email = document.getElementById('signup-email').value.trim();
  const password = document.getElementById('signup-password').value;

  try {
    const data = await signUp(email, password, name);
    if (data?.session?.token) {
      showSuccessAndRedirect();
    } else if (data?.user) {
      // Send verification email automatically after signup
      await sendVerificationEmail(email);
      pendingEmail = email;
      pendingPassword = password;
      pendingName = name;
      showVerifyStep(email);
    }
  } catch (err) {
    setError(errors.signup, err.message || 'Sign up failed. Please try again.');
  } finally {
    isProcessing = false;
    setButtonLoading(submitButtons.signup, false);
    validateForm('signup');
  }
}

async function handleVerify(event) {
  event.preventDefault();
  if (isProcessing || !validateForm('verify')) return;

  isProcessing = true;
  setButtonLoading(submitButtons.verify, true);
  clearErrors();

  const code = document.getElementById('verify-code').value.trim();

  try {
    await verifyEmail(pendingEmail, code);
    // After verification, sign in to get session
    const data = await signIn(pendingEmail, pendingPassword);
    if (data?.session?.token) {
      showSuccessAndRedirect();
    } else {
      setError(errors.verify, 'Verification succeeded but sign in failed. Please try signing in.');
    }
  } catch (err) {
    setError(errors.verify, err.message || 'Verification failed. Please try again.');
  } finally {
    isProcessing = false;
    setButtonLoading(submitButtons.verify, false);
    validateForm('verify');
  }
}

async function handleResendCode() {
  if (isProcessing) return;
  isProcessing = true;
  resendButton.disabled = true;
  resendButton.textContent = 'Sending…';

  try {
    await sendVerificationEmail(pendingEmail);
    setError(errors.verify, '');
    // Show a brief success message
    resendButton.textContent = 'Sent!';
    setTimeout(() => { resendButton.textContent = 'Resend code'; }, 2000);
  } catch (err) {
    setError(errors.verify, err.message || 'Could not resend code. Please try again.');
  } finally {
    isProcessing = false;
    resendButton.disabled = false;
  }
}

function showVerifyStep(email) {
  verifyEmailDisplay.textContent = email;
  document.getElementById('verify-code').value = '';
  showStep('verify');
  // Focus the code input
  setTimeout(() => document.getElementById('verify-code').focus(), 100);
}

function showSuccessAndRedirect() {
  showStep('success');
  setTimeout(() => {
    // Check if there's a redirect parameter
    const params = new URLSearchParams(location.search);
    const redirect = params.get('redirect') || '/host';
    location.assign(redirect);
  }, 1500);
}

function goBackToCredentials() {
  showStep('credentials');
  clearErrors();
  document.getElementById('verify-code').value = '';
}

// Check for existing session on load
async function checkExistingSession() {
  try {
    const data = await getSession();
    if (data?.session?.token) {
      showSuccessAndRedirect();
    }
  } catch {
    // No session, continue to login form
  }
}

// Event listeners
tabs.signin.addEventListener('click', () => showTab('signin'));
tabs.signup.addEventListener('click', () => showTab('signup'));

forms.signin.addEventListener('submit', handleSignIn);
forms.signup.addEventListener('submit', handleSignUp);
forms.verify.addEventListener('submit', handleVerify);

backButton.addEventListener('click', goBackToCredentials);
resendButton.addEventListener('click', handleResendCode);

// Real-time validation
['signin', 'signup', 'verify'].forEach(formId => {
  const form = forms[formId];
  if (form) {
    form.querySelectorAll('input').forEach(input => {
      input.addEventListener('input', () => validateForm(formId));
      input.addEventListener('blur', () => validateForm(formId));
    });
  }
});

// Initialize
checkExistingSession();