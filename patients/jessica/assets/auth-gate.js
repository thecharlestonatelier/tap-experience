/* ==================================================================
   THE CHARLESTON ATELIER — first-tap auth gate
   ------------------------------------------------------------------
   An ES module, imported lazily by protocol.js the first time a stored
   card is opened. A classic script cannot import the CDN modules, so
   protocol.js dynamic-imports this file and awaits the handshake on
   window.__authGate.

   It renders the full-screen welcome gate, drives the Google sign-in
   (redirect, never popup), posts the ID token to /api/activate/<slug>,
   and resolves 'open' — or 'blocked' when the card already belongs to
   a different account, which is never overwritten.

   The service writes the link exactly once. This module only asks for
   it; the answer decides what the patient sees.
   ================================================================== */

import { initializeApp } from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-app.js';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithRedirect,
  getRedirectResult,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  updateProfile,
  sendPasswordResetEmail
} from 'https://www.gstatic.com/firebasejs/13.1.0/firebase-auth.js';
import { firebaseConfig } from './firebase.js';

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

/* On a laptop the whole flow runs against the Auth emulator. The host
   check gates it, so nothing here reaches production. */
if (location.hostname === 'localhost' || location.hostname === '127.0.0.1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
}

/* ---------- the overlay ---------- */

function overlay(state, content) {
  let el = document.getElementById('auth-gate');
  if (!el) {
    el = document.createElement('div');
    el.id = 'auth-gate';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'true');
    el.style.cssText = [
      'position:fixed; inset:0; z-index:1000; display:flex; flex-direction:column;',
      'align-items:center; justify-content:center; gap:14px; padding:28px;',
      'text-align:center; background:var(--bg,#F3EBE1); color:var(--espresso-soft,#4A3B2C);',
      'font-family:Jost,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;'
    ].join('');
    document.body.appendChild(el);
  }
  el.dataset.state = state;
  el.replaceChildren(content);
  return el;
}

function hideGate() {
  const el = document.getElementById('auth-gate');
  if (el) el.remove();
}

/* The concierge's own message link, shared with the rest of the portal:
   an sms: deep link that hands off to her phone's Messages app. */
function conciergeHref() {
  if (typeof window !== 'undefined' && typeof window.smsHref === 'function') {
    const href = window.smsHref();
    if (href && href !== '#') return href;
  }
  return 'sms:';
}

/* Set the moment the Google redirect leaves the page. When the next load
   finds this marker but no redirect result and no session, the handoff
   back from Google failed — which must be said, never looped silently. */
const GOOGLE_PENDING_KEY = 'tca.google.pending';

function clearGooglePending() {
  try { sessionStorage.removeItem(GOOGLE_PENDING_KEY); } catch {}
}

const GOOGLE_G = '<svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">' +
  '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
  '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
  '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
  '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

function monogram() {
  const mark = document.createElement('div');
  mark.textContent = 'CA';
  mark.style.cssText = [
    'width:72px; height:72px; border-radius:20px; display:flex; align-items:center;',
    'justify-content:center; background:#F3EBE1; color:#8A7350;',
    'font-family:Georgia,serif; font-size:32px; font-weight:700;',
    'box-shadow:0 0 0 1px var(--hairline,rgba(138,115,80,0.18)), 0 10px 26px rgba(59,46,32,0.14);'
  ].join('');
  return mark;
}

function messageLink(label) {
  const a = document.createElement('a');
  a.textContent = label;
  a.href = conciergeHref();
  a.style.cssText = 'color:var(--brass,#8A7350); font-size:15px; text-decoration:underline; cursor:pointer;';
  return a;
}

/* The full-screen welcome: monogram, one Google button, an email path,
   and the quiet fallback for a patient without either. */
function showWelcome() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:14px; max-width:320px;';

  const title = document.createElement('h1');
  title.textContent = 'Welcome to The Charleston Atelier';
  title.style.cssText = 'font-size:22px; font-weight:600; color:var(--espresso,#3B2E20); line-height:1.25;';

  const copy = document.createElement('p');
  copy.textContent = 'Sign in once so this card knows it\u2019s yours. You won\u2019t be asked again on this phone.';
  copy.style.cssText = 'font-size:15px; line-height:1.55; color:var(--espresso-soft,#4A3B2C);';

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = GOOGLE_G +
    '<span style="font:inherit">Sign in with Google</span>';
  btn.style.cssText = [
    'display:flex; align-items:center; gap:10px; margin-top:6px; padding:13px 26px;',
    'border-radius:12px; border:1px solid rgba(59,46,32,0.14); background:var(--card,#F8F2EA);',
    'color:var(--espresso-soft,#4A3B2C); font-family:inherit; font-size:16px; font-weight:500;',
    'cursor:pointer; box-shadow:0 2px 8px rgba(59,46,32,0.10);'
  ].join('');
  btn.addEventListener('click', () => {
    btn.disabled = true;
    btn.style.opacity = '0.6';
    // Redirect, never popup: mobile browsers block popups, and this is a phone.
    // The marker is what lets the returning page tell "a sign-in was started"
    // apart from a plain first visit, so a failed handoff is never a loop.
    try { sessionStorage.setItem(GOOGLE_PENDING_KEY, '1'); } catch {}
    signInWithRedirect(auth, new GoogleAuthProvider()).catch(() => {
      btn.disabled = false;
      btn.style.opacity = '';
      clearGooglePending();
      copy.textContent = 'Sign-in didn\u2019t open. Please try again, or message the atelier below.';
    });
  });

  const email = document.createElement('a');
  email.textContent = 'Use email instead';
  email.href = '#';
  email.setAttribute('data-email', '');
  email.style.cssText = 'font-size:15px; color:var(--brass,#8A7350); text-decoration:underline; cursor:pointer; margin-top:2px;';
  email.addEventListener('click', e => {
    e.preventDefault();
    showEmailForm();
  });

  const or = document.createElement('p');
  or.textContent = 'Don\u2019t have a Google account or an email account?';
  or.style.cssText = 'font-size:14px; margin-top:8px;';

  wrap.append(monogram(), title, copy, btn, email, or, messageLink('Message the atelier \u2192'));
  overlay('welcome', wrap);
}

/* ---------- email + password form ----------
   One form, two modes. Sign-up is the default — a new patient has no
   account yet. The name field only exists in sign-up mode; a returning
   email account already carries its name. Validation runs before any
   SDK call. The flows themselves are wired in the next phase. */

const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PASSWORD_MIN = 8;

function field(label, type, autocomplete) {
  const box = document.createElement('label');
  box.style.cssText = 'display:block; text-align:left; width:100%; font-size:13px; color:var(--espresso-soft,#4A3B2C);';
  const text = document.createElement('span');
  text.textContent = label;
  const input = document.createElement('input');
  input.type = type;
  if (autocomplete) input.autocomplete = autocomplete;
  input.style.cssText = [
    'display:block; width:100%; margin-top:4px; padding:11px 12px; font:inherit;',
    'border:1px solid rgba(59,46,32,0.25); border-radius:10px; background:#fff; color:var(--espresso,#3B2E20);'
  ].join('');
  const err = document.createElement('span');
  err.setAttribute('data-field-error', '');
  err.style.cssText = 'display:none; margin-top:3px; font-size:12px; color:#a4553f;';
  box.append(text, input, err);
  return { box, input, err };
}

function showEmailForm() {
  let mode = 'signup';

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:12px; max-width:320px; width:100%;';

  const back = document.createElement('a');
  back.textContent = '\u2190 Back to sign-in options';
  back.href = '#';
  back.style.cssText = 'font-size:14px; color:var(--brass,#8A7350); text-decoration:underline; cursor:pointer; align-self:flex-start;';
  back.addEventListener('click', e => { e.preventDefault(); showWelcome(); });

  const title = document.createElement('h1');
  title.textContent = 'Create your account';
  title.style.cssText = 'font-size:22px; font-weight:600; color:var(--espresso,#3B2E20);';
  const sub = document.createElement('p');
  sub.textContent = 'Your name goes on the card so the atelier knows it is yours.';
  sub.style.cssText = 'font-size:14px; line-height:1.5; color:var(--espresso-soft,#4A3B2C);';

  const email = field('Email', 'email', 'email');
  const password = field('Password (at least 8 characters)', 'password', 'current-password');
  const name = field('Your name', 'text', 'name');

  const formError = document.createElement('p');
  formError.setAttribute('data-form-error', '');
  formError.style.cssText = 'display:none; width:100%; font-size:13px; color:#a4553f; text-align:left;';

  const submit = document.createElement('button');
  submit.type = 'button';
  submit.textContent = 'Create account';
  submit.style.cssText = [
    'width:100%; padding:13px; border-radius:12px; border:none; cursor:pointer;',
    'background:var(--brass,#8A7350); color:#F3EBE1; font:inherit; font-size:16px; font-weight:500;'
  ].join('');

  const toggle = document.createElement('a');
  toggle.href = '#';
  toggle.style.cssText = 'font-size:14px; color:var(--brass,#8A7350); text-decoration:underline; cursor:pointer;';

  const forgot = document.createElement('a');
  forgot.textContent = 'Forgot password?';
  forgot.href = '#';
  forgot.style.cssText = 'font-size:14px; color:var(--brass,#8A7350); text-decoration:underline; cursor:pointer;';
  let forgotSent = false;
  forgot.addEventListener('click', async e => {
    e.preventDefault();
    if (forgotSent) return;
    const value = email.input.value.trim();
    if (!EMAIL_OK.test(value)) {
      email.err.textContent = 'Enter a valid email address.';
      email.err.style.display = 'block';
      return;
    }
    // Enumeration protection means the call resolves even for unknown
    // addresses, and the confirmation must not reveal which case it was.
    // But a real misconfiguration — the provider disabled, or the network
    // down — must not masquerade as "sent".
    try {
      await sendPasswordResetEmail(auth, value, {
        url: `${location.origin}/${currentSlug}`,
        handleCodeInApp: false
      });
    } catch (err) {
      if (err && (err.code === 'auth/operation-not-allowed' ||
                  err.code === 'auth/network-request-failed' ||
                  err.code === 'auth/internal-error')) {
        forgot.textContent = 'Couldn\u2019t send the reset email \u2014 try again, or message the atelier.';
        return;
      }
    }
    forgot.textContent = 'If that email has an account here, a reset link is on its way.';
    forgot.style.cursor = 'default';
    forgotSent = true;
  });

  function paint() {
    title.textContent = mode === 'signup' ? 'Create your account' : 'Sign in with email';
    sub.textContent = mode === 'signup'
      ? 'Your name goes on the card so the atelier knows it is yours.'
      : 'Sign in to keep using your card.';
    name.box.style.display = mode === 'signup' ? 'block' : 'none';
    submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in';
    // A password manager should only autofill a saved login in sign-in
    // mode; in sign-up it is a brand-new password.
    password.input.autocomplete = mode === 'signup' ? 'new-password' : 'current-password';
    toggle.textContent = mode === 'signup' ? 'Already have an account? Sign in' : 'New here? Create an account';
    forgot.style.display = mode === 'signin' ? 'inline-block' : 'none';
  }
  toggle.addEventListener('click', e => {
    e.preventDefault();
    mode = mode === 'signup' ? 'signin' : 'signup';
    email.err.style.display = 'none';
    password.err.style.display = 'none';
    name.err.style.display = 'none';
    formError.style.display = 'none';
    paint();
  });

  function invalid(which, message) {
    which.err.textContent = message;
    which.err.style.display = 'block';
  }

  submit.addEventListener('click', () => {
    const okEmail = EMAIL_OK.test(email.input.value.trim());
    const okPassword = password.input.value.length >= PASSWORD_MIN;
    const okName = mode === 'signin' || name.input.value.trim().length > 0;
    email.err.style.display = okEmail ? 'none' : 'block';
    password.err.style.display = okPassword ? 'none' : 'block';
    name.err.style.display = okName ? 'none' : 'block';
    if (!okEmail) invalid(email, 'Enter a valid email address.');
    if (!okPassword) invalid(password, `Use at least ${PASSWORD_MIN} characters.`);
    if (!okName) invalid(name, 'Tell us your name.');
    if (okEmail && okPassword && okName) {
      formError.style.display = 'none';
      submitEmailForm(mode, email.input.value.trim(), password.input.value, name.input.value.trim(),
        { toggle, formError, emailErr: email.err, passwordErr: password.err, submit });
    }
  });

  paint();
  wrap.append(back, title, sub, email.box, password.box, name.box, formError, submit, toggle, forgot);
  overlay('email', wrap);
}

/* The SDK flows behind the form — create or sign in, then link the card.
   Errors map to the field or the form, never to the server: a wrong
   password and an unknown email look the same on purpose (email
   enumeration protection), and only the create path's
   email-already-in-use proves an account exists. */
async function submitEmailForm(mode, emailValue, passwordValue, nameValue, ui) {
  const { toggle, formError, emailErr, passwordErr, submit } = ui;
  const fieldMsg = (which, msg) => { which.textContent = msg; which.style.display = 'block'; };
  const formMsg = (msg) => { formError.textContent = msg; formError.style.display = 'block'; };

  // A double-tap must not fire two sign-up calls; the loser would flip
  // the form to sign-in even though the first succeeded.
  const idle = () => { submit.disabled = false; submit.textContent = mode === 'signup' ? 'Create account' : 'Sign in'; };
  submit.disabled = true;
  submit.textContent = 'One moment\u2026';

  try {
    let user;
    if (mode === 'signup') {
      const cred = await createUserWithEmailAndPassword(auth, emailValue, passwordValue);
      // The name has to travel in the ID token's name claim, and the token
      // minted at creation predates this write — force a refresh before the
      // card links, or the atelier stores an empty name.
      await updateProfile(cred.user, { displayName: nameValue });
      user = cred.user;
    } else {
      user = (await signInWithEmailAndPassword(auth, emailValue, passwordValue)).user;
    }
    const outcome = await linkCard(currentSlug, user, mode === 'signup');
    if (outcome === 'no-token') {
      // The session could not produce a token; back to the welcome gate
      // with the resolver still armed so the patient can try again.
      showWelcome();
      return;
    }
    finishEmailFlow(outcome);
  } catch (err) {
    idle();
    const code = err && err.code;
    if (code === 'auth/email-already-in-use') {
      // Switch to sign-in and keep the typed email in the box.
      toggle.click();
      formMsg('This email already has an account \u2014 sign in instead.');
    } else if (code === 'auth/weak-password') {
      fieldMsg(passwordErr, 'That password is too weak \u2014 use at least 8 characters.');
    } else if (code === 'auth/invalid-email') {
      fieldMsg(emailErr, 'Enter a valid email address.');
    } else if (code === 'auth/invalid-credential' || code === 'auth/wrong-password' ||
               code === 'auth/user-not-found') {
      formMsg('That email or password is wrong, or this email has no account here. Check and try again, or create an account.');
    } else {
      formMsg('We couldn\u2019t reach the service \u2014 try again, or message the atelier.');
    }
  }
}

/* The quiet stuck screen: one message, one action. Shown when the card
   already belongs to a different account, which is never overwritten.
   The copy is provider-agnostic on purpose — the service does not tell
   the card which method owns it, so the patient is pointed at both. */
function showStuck() {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:14px; max-width:320px;';

  const title = document.createElement('h1');
  title.textContent = 'This card is already activated';
  title.style.cssText = 'font-size:22px; font-weight:600; color:var(--espresso,#3B2E20);';

  const copy = document.createElement('p');
  copy.textContent = 'It belongs to a different account. If you used Google before, sign in with Google; if you used email, sign in with that email. If this is your card and neither works, message us \u2014 we\u2019ll sort it out.';
  copy.style.cssText = 'font-size:15px; line-height:1.55; color:var(--espresso-soft,#4A3B2C);';

  const btn = document.createElement('a');
  btn.textContent = 'Message the atelier';
  btn.href = conciergeHref();
  btn.style.cssText = [
    'display:inline-block; margin-top:6px; padding:13px 26px; border-radius:12px;',
    'background:var(--brass,#8A7350); color:#F3EBE1; font-size:16px; font-weight:500;',
    'text-decoration:none; box-shadow:0 2px 8px rgba(59,46,32,0.10);'
  ].join('');

  wrap.append(monogram(), title, copy, btn);
  overlay('blocked', wrap);
}

/* A Google sign-in that did not survive its round trip. The patient did
   log in; the card just never received the session back. The message
   says why, and the email path stays open — a loop teaches nothing and
   wastes a tap. */
function showGoogleFailure(message) {
  // The attempt is settled: a reload should come back to the welcome
  // gate, not re-claim a lost handoff.
  clearGooglePending();

  const wrap = document.createElement('div');
  wrap.style.cssText = 'display:flex; flex-direction:column; align-items:center; gap:14px; max-width:320px;';

  const title = document.createElement('h1');
  title.textContent = 'Google sign-in didn\u2019t finish';
  title.style.cssText = 'font-size:22px; font-weight:600; color:var(--espresso,#3B2E20); line-height:1.25;';

  const copy = document.createElement('p');
  copy.textContent = message;
  copy.style.cssText = 'font-size:15px; line-height:1.55; color:var(--espresso-soft,#4A3B2C);';

  const email = document.createElement('a');
  email.textContent = 'Use email instead';
  email.href = '#';
  email.style.cssText = 'font-size:15px; color:var(--brass,#8A7350); text-decoration:underline; cursor:pointer;';
  email.addEventListener('click', e => { e.preventDefault(); showEmailForm(); });

  const retry = document.createElement('a');
  retry.textContent = 'Try Google again';
  retry.href = '#';
  retry.style.cssText = 'font-size:15px; color:var(--brass,#8A7350); text-decoration:underline; cursor:pointer;';
  retry.addEventListener('click', e => { e.preventDefault(); showWelcome(); });

  wrap.append(monogram(), title, copy, email, retry, messageLink('Message the atelier \u2192'));
  overlay('google-failed', wrap);
}

/* ---------- the handshake ---------- */

/* Which card this page is gating, and the resolver the email flow uses
   to let the boot continue once the link lands in-page (Google finishes
   through a redirect instead). */
let currentSlug = null;
let resolveEmailFlow = null;

function finishEmailFlow(outcome) {
  if (resolveEmailFlow) {
    const resolve = resolveEmailFlow;
    resolveEmailFlow = null;
    resolve(outcome);
  }
}

/* Who is signed in right now. A sign-in that just completed comes back
   as a redirect result; an account that exists under another provider
   must not be silently re-welcomed into a loop. Every other failure is
   named instead of swallowed, so the patient sees why and the console
   carries the code. */
async function signedInUser() {
  let hadPendingGoogle = false;
  try { hadPendingGoogle = sessionStorage.getItem(GOOGLE_PENDING_KEY) === '1'; } catch {}

  try {
    const result = await getRedirectResult(auth);
    if (result && result.user) {
      clearGooglePending();
      return result.user;
    }
  } catch (err) {
    clearGooglePending();
    console.error('[auth-gate] Google redirect result failed:', err && err.code, err);
    if (err && err.code === 'auth/account-exists-with-different-credential') {
      return 'blocked';
    }
    // Only a load that follows a started Google attempt reports the
    // failure; an ordinary first visit with an unreachable Auth service
    // still welcomes, exactly as before.
    if (hadPendingGoogle) return { failed: err };
  }

  // A session the SDK has already restored, for example after an in-page
  // email sign-in or a remembered visit.
  const user = auth.currentUser;
  if (user) { clearGooglePending(); return user; }

  // The marker is set and the redirect came back empty: the handoff from
  // Google to this browser was lost. Say so rather than re-welcome.
  if (hadPendingGoogle) return 'handoff-lost';

  return null;
}

/* Wait without resolving: the page stays behind the gate until the
   redirect brings a fresh page load back. */
function forever() { return new Promise(() => {}); }

/* Post the ID token and let the service decide: linked, verified, or
   blocked. Force-refresh after a fresh email sign-up so the name claim
   makes the trip. A missing token returns 'no-token' so the caller can
   re-arm the gate instead of dead-ending. */
async function linkCard(slug, user, forceRefresh = false) {
  const idToken = await user.getIdToken(forceRefresh).catch(() => null);
  if (!idToken) return 'no-token';

  // A real session reached this point, so a half-finished Google attempt
  // from an earlier load can no longer masquerade as a lost handoff.
  clearGooglePending();

  let res;
  try {
    res = await fetch(`/api/activate/${encodeURIComponent(slug)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken })
    });
  } catch {
    // The service is unreachable. A signed-in device must still reach its
    // dose — open best-effort rather than lock her out.
    hideGate();
    return 'open';
  }

  if (res.status === 409) {
    showStuck();
    return 'blocked';
  }
  hideGate();
  return 'open';
}

async function ensureActivated({ slug }) {
  currentSlug = slug;
  const user = await signedInUser();
  if (user === 'blocked') {
    showStuck();
    return 'blocked';
  }
  if (user === 'handoff-lost') {
    showGoogleFailure('Google signed you in, but this browser did not hand the sign-in back to the card. Private browsing and strict privacy settings can do this. Try again, or use your email instead.');
    return await new Promise(resolve => { resolveEmailFlow = resolve; });
  }
  if (user && user.failed) {
    const code = (user.failed && user.failed.code) || 'unknown';
    const message = code === 'auth/operation-not-allowed'
      ? 'The Google sign-in method is not switched on for this card yet. Use email instead, or message the atelier.'
      : `Google sign-in could not finish (${code}). Try again, or use your email instead.`;
    showGoogleFailure(message);
    return await new Promise(resolve => { resolveEmailFlow = resolve; });
  }
  if (user) {
    const outcome = await linkCard(slug, user, false);
    if (outcome !== 'no-token') return outcome;
    // No token after all: fall through and treat this as no session.
  }

  // No session. The Google path navigates away and comes back as a fresh
  // load; the email path completes in-page and resolves this promise.
  showWelcome();
  return await new Promise(resolve => { resolveEmailFlow = resolve; });
}

window.__authGate = { ensureActivated };
export { ensureActivated };
