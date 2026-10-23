// ============================================================
// WUP Registrar — front end
// ============================================================


// The "refer to Wesleyan Automate" pop-up appears once, at the Pending Review step.
// Only applies to grade-bearing documents (Certificate of Grades, Transcript of Records).
// Excludes Certificate of Enrollment (COE).
const GRADES_NOTICE_ONLY_FOR = ['Certificate of Grades', 'Transcript of Records'];

const OR_USED_MESSAGE = 'This OR number has already been used and cannot be used again.';

let currentUser = null;
let requestsData = [];
let requestableDocs = [];   // active documents (what a student can pick from)
let documentsData = [];     // every document (registrar's Documents tab)
let feesData = [];
let receiptsData = [];      // staff: all receipts; students: sample available receipts
let currentView = 'requests';   // 'requests' | 'documents' | 'fees' | 'receipts'
let currentFilter = 'all';
let currentActiveReviewRef = null;
let selectedDocsMap = {};
let uploadedAssessmentPhotoData = '';
let showingSetPassword = false;
let forcedPasswordChange = false;
let editingFeeId = null;
let editingDocId = null;
let pendingGradesRef = null;
let readyModalRef = null;
let readyModalIsChange = false;
let orUsed = false;
let orValid = false;
let orCheckTimer = null;
let orCheckSeq = 0;
let receiptSearchQuery = '';

// ---------- small helpers ----------
function esc(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function money(n) {
  return Number(n).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function todayLocal() {
  return new Date().toLocaleDateString('en-CA'); // YYYY-MM-DD
}
function dateParts(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return {
    mon: dt.toLocaleDateString('en-US', { month: 'short' }).toUpperCase(),
    day: d,
    dow: dt.toLocaleDateString('en-US', { weekday: 'long' }),
    full: dt.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
  };
}
function show(id) { const el = document.getElementById(id); if (el) el.classList.remove('hidden'); }
function hide(id) { const el = document.getElementById(id); if (el) el.classList.add('hidden'); }
function itemsLabel(req) { return req.items.map(i => `${i.copies}x ${esc(i.name)}`).join(', '); }

// ============================================================
// Fancy Pop-up Dialog System (replaces native alert & confirm)
// ============================================================
let fancyDialogResolver = null;

function showFancyDialog({
  title = 'Attention',
  message = '',
  type = 'warning', // 'warning' | 'danger' | 'success' | 'info'
  confirmText = 'Got it',
  cancelText = 'Cancel',
  showCancel = false,
  dangerConfirm = false,
  icon = null
} = {}) {
  return new Promise((resolve) => {
    fancyDialogResolver = resolve;

    const modal = document.getElementById('modalFancyDialog');
    const titleEl = document.getElementById('fancyDialogTitle');
    const msgEl = document.getElementById('fancyDialogMessage');
    const iconEl = document.getElementById('fancyDialogIcon');
    const confirmBtn = document.getElementById('fancyDialogConfirmBtn');
    const cancelBtn = document.getElementById('fancyDialogCancelBtn');

    if (!modal || !titleEl || !msgEl || !confirmBtn) {
      resolve(showCancel ? window.confirm(message) : (window.alert(message), true));
      return;
    }

    titleEl.innerText = title;
    msgEl.innerHTML = esc(message).replace(/\n/g, '<br>');

    // Apply icon type styling
    iconEl.className = 'modal-icon fancy-icon-pulse ' + type;
    let iconClass = 'fa-triangle-exclamation';
    if (icon) {
      iconClass = icon;
    } else if (type === 'danger') {
      iconClass = 'fa-trash-can';
    } else if (type === 'success') {
      iconClass = 'fa-circle-check';
    } else if (type === 'info') {
      iconClass = 'fa-circle-info';
    }
    iconEl.innerHTML = `<i class="fa-solid ${esc(iconClass)}"></i>`;

    // Confirm button
    confirmBtn.innerText = confirmText;
    confirmBtn.className = dangerConfirm ? 'btn btn-danger' : 'btn btn-primary';

    // Cancel button
    if (showCancel && cancelBtn) {
      cancelBtn.innerText = cancelText;
      cancelBtn.classList.remove('hidden');
    } else if (cancelBtn) {
      cancelBtn.classList.add('hidden');
    }

    modal.classList.remove('hidden');

    // Auto-focus the safe button
    setTimeout(() => {
      if (showCancel && dangerConfirm && cancelBtn) {
        cancelBtn.focus();
      } else {
        confirmBtn.focus();
      }
    }, 40);
  });
}

function closeFancyDialog(result = false) {
  const modal = document.getElementById('modalFancyDialog');
  if (modal) modal.classList.add('hidden');
  if (typeof fancyDialogResolver === 'function') {
    const fn = fancyDialogResolver;
    fancyDialogResolver = null;
    fn(result);
  }
}

function fancyAlert(message, title = 'Attention', type = 'warning', confirmText = 'Got it') {
  return showFancyDialog({
    title,
    message,
    type,
    confirmText,
    showCancel: false,
    dangerConfirm: false
  });
}

function fancyConfirm(message, title = 'Please Confirm', {
  confirmText = 'Yes, continue',
  cancelText = 'Cancel',
  type = 'danger',
  dangerConfirm = true
} = {}) {
  return showFancyDialog({
    title,
    message,
    type,
    confirmText,
    cancelText,
    showCancel: true,
    dangerConfirm
  });
}

// Global safety net for any standard alert calls
window.alert = function (message) {
  return fancyAlert(message, 'Attention', 'warning');
};

// ---------- API helper ----------
async function apiRequest(method, path, body) {
  const opts = { method, headers: {}, credentials: 'include' };
  const token = localStorage.getItem('wup_session_token');
  if (token) {
    opts.headers['Authorization'] = 'Bearer ' + token;
  }
  if (body !== undefined) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const res = await fetch('/api' + path, opts);
  let data = null;
  try { data = await res.json(); } catch (e) { /* no body */ }
  if (res.status === 401 && path !== '/login') {
    if (currentUser) {
      localStorage.removeItem('wup_session_token');
      currentUser = null;
      requestsData = [];
      stopStaffAutoRefresh();
      renderApp();
      throw new Error('Your session expired. Please log in again.');
    }
  }
  if (!res.ok) {
    const err = new Error((data && data.error) || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return data;
}

async function refreshRequestsData() {
  if (!currentUser) { requestsData = []; return; }
  requestsData = await apiRequest('GET', '/requests');
}
async function loadFees() {
  feesData = await apiRequest('GET', '/fees');
}
async function loadDocuments() {
  documentsData = await apiRequest('GET', '/documents'); // staff get every document
}
async function loadReceipts() {
  receiptsData = await apiRequest('GET', '/receipts');
}
async function loadReference() {
  try {
    if (currentUser && currentUser.role === 'staff') {
      await Promise.all([
        loadFees(),
        loadDocuments(),
        loadReceipts()
      ]);
    } else {
      await loadFees();
    }
  } catch (e) { /* the tabs show an empty state; a 401 is handled in apiRequest */ }
}
function applyUpdatedRequest(updated) {
  const idx = requestsData.findIndex(r => r.ref === updated.ref);
  if (idx >= 0) requestsData[idx] = updated;
  else requestsData.unshift(updated);
}

window.addEventListener('DOMContentLoaded', async () => {
  // Wire up fancy pop-up dialog events
  const fancyConfirmBtn = document.getElementById('fancyDialogConfirmBtn');
  const fancyCancelBtn = document.getElementById('fancyDialogCancelBtn');
  const fancyModal = document.getElementById('modalFancyDialog');

  if (fancyConfirmBtn) fancyConfirmBtn.onclick = () => closeFancyDialog(true);
  if (fancyCancelBtn) fancyCancelBtn.onclick = () => closeFancyDialog(false);
  if (fancyModal) {
    fancyModal.addEventListener('click', (e) => {
      if (e.target === fancyModal) closeFancyDialog(false);
    });
  }

  window.addEventListener('keydown', (e) => {
    if (!fancyModal || fancyModal.classList.contains('hidden')) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeFancyDialog(false);
    } else if (e.key === 'Enter') {
      if (document.activeElement === fancyCancelBtn) return;
      e.preventDefault();
      closeFancyDialog(true);
    }
  });

  // Restore the logged-in session (if any) so refreshing the page doesn't kick people to the login screen.
  try {
    currentUser = await apiRequest('GET', '/me');
    if (currentUser && currentUser.token) {
      localStorage.setItem('wup_session_token', currentUser.token);
    }
  } catch (e) {
    currentUser = null;
  }

  if (currentUser) {
    const savedView = localStorage.getItem('wup_current_view');
    const savedFilter = localStorage.getItem('wup_current_filter');
    if (savedView) currentView = savedView;
    if (savedFilter) currentFilter = savedFilter;

    try {
      await Promise.all([
        refreshRequestsData(),
        loadReference()
      ]);
    } catch (e) {
      console.warn('Dashboard data refresh on load:', e);
    }

    if (currentUser.mustChangePassword) {
      openSetPasswordScreen(true);
      return;
    }
  }

  renderApp();
  startStaffAutoRefresh();
  initOtpInputs();
  // Fetch EmailJS config from server if not set locally
  if (!localStorage.getItem('wup_emailjs_config')) {
    apiRequest('GET', '/auth/emailjs-config').then(cfg => {
      if (cfg && (cfg.serviceId || cfg.publicKey)) {
        localStorage.setItem('wup_emailjs_config', JSON.stringify(cfg));
      }
    }).catch(() => { });
  }
});

// ---------- registrar: pick up new student requests without a manual refresh ----------
let staffRefreshTimer = null;
function startStaffAutoRefresh() {
  stopStaffAutoRefresh();
  if (!currentUser || currentUser.role !== 'staff') return;
  staffRefreshTimer = setInterval(async () => {
    if (document.hidden) return;
    // don't redraw under the registrar's hands while a window is open
    if (document.querySelector('.modal:not(.hidden)')) return;
    try {
      await refreshRequestsData();
      if (currentView === 'requests') renderStaffDashboard();
      renderSidebarNav();
    } catch (e) { /* ignore; a 401 is handled in apiRequest */ }
  }, 15000);
}
function stopStaffAutoRefresh() {
  if (staffRefreshTimer) clearInterval(staffRefreshTimer);
  staffRefreshTimer = null;
}

// ============================================================
// AUTH: LOGIN / LOGOUT
// ============================================================
async function handleUnifiedLogin(e) {
  e.preventDefault();
  const u = document.getElementById('inputUsername').value.trim();
  const p = document.getElementById('inputPassword').value.trim();
  const errBox = document.getElementById('loginError');
  errBox.classList.add('hidden');

  const submitBtn = e.target.querySelector('button[type="submit"]') || e.submitter;
  const originalText = submitBtn ? submitBtn.innerHTML : 'Sign in';
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Signing in...';
  }

  try {
    currentUser = await apiRequest('POST', '/login', { username: u, password: p });
    if (currentUser && currentUser.token) {
      localStorage.setItem('wup_session_token', currentUser.token);
    }
  } catch (err) {
    errBox.classList.remove('hidden');
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = originalText;
    }
    return;
  }

  try {
    currentView = 'requests';
    currentFilter = 'all';
    localStorage.setItem('wup_current_view', 'requests');
    localStorage.setItem('wup_current_filter', 'all');
    await Promise.all([
      refreshRequestsData(),
      loadReference()
    ]);
  } catch (err) { /* dashboards show an empty state */ }

  if (submitBtn) {
    submitBtn.disabled = false;
    submitBtn.innerHTML = originalText;
  }

  // Anyone (student or registrar staff) still on a default password must set a real one first.
  if (currentUser.mustChangePassword) {
    openSetPasswordScreen(true);
  } else {
    showingSetPassword = false;
    forcedPasswordChange = false;
    renderApp();
    startStaffAutoRefresh();
  }
}

function togglePasswordVisibility() {
  const field = document.getElementById('inputPassword');
  const icon = document.getElementById('eyeIcon');
  if (field.type === 'password') {
    field.type = 'text';
    icon.className = 'fa-regular fa-eye-slash';
  } else {
    field.type = 'password';
    icon.className = 'fa-regular fa-eye';
  }
}

function handleLogout() {
  stopStaffAutoRefresh();
  localStorage.removeItem('wup_session_token');
  localStorage.removeItem('wup_current_view');
  localStorage.removeItem('wup_current_filter');
  apiRequest('POST', '/logout').catch(() => { });
  currentUser = null;
  requestsData = [];
  showingSetPassword = false;
  forcedPasswordChange = false;
  document.getElementById('loginForm').reset();
  document.getElementById('loginError').classList.add('hidden');
  closeMobileSidebar();
  renderApp();
}

// ============================================================
// FORGOT PASSWORD WITH OTP (MailJS Email Delivery)
// ============================================================

let forgotState = {
  step: 1,
  identifier: '',
  userType: '',
  userId: '',
  name: '',
  maskedEmail: '',
  rawEmail: '',
  selectedMethod: 'email',
  resetToken: '',
  changeToken: '',
  otpTimer: null,
  timerExpiresAt: 0,
  resendTimer: null,
  resendCountdown: 30,
  lastOtpCode: ''
};

function openForgotPasswordInfo() {
  resetForgotModal();
  show('modalForgotInfo');
  setTimeout(() => {
    const inp = document.getElementById('forgotIdentifierInput');
    if (inp) inp.focus();
  }, 100);
}

function closeForgotPasswordInfo() {
  hide('modalForgotInfo');
  stopOtpTimer();
  stopResendTimer();
}

function resetForgotModal() {
  stopOtpTimer();
  stopResendTimer();
  forgotState = {
    step: 1,
    identifier: '',
    userType: '',
    userId: '',
    name: '',
    maskedEmail: '',
    rawEmail: '',
    selectedMethod: 'email',
    resetToken: '',
    changeToken: '',
    otpTimer: null,
    timerExpiresAt: 0,
    resendTimer: null,
    resendCountdown: 30,
    lastOtpCode: ''
  };
  goToForgotStep(1);
  const fLookup = document.getElementById('forgotLookupForm');
  if (fLookup) fLookup.reset();
  const fPw = document.getElementById('forgotResetPwForm');
  if (fPw) fPw.reset();
  hide('forgotStep1Error');
  hide('forgotStep2Error');
  hide('forgotStep3Error');
  hide('forgotStep4Error');
  hide('forgotDispatchNotice');
  resetForgotPwMeter();
  clearOtpInputs();
}

function goToForgotStep(stepNum) {
  forgotState.step = stepNum;
  // Update step views
  for (let i = 1; i <= 5; i++) {
    const el = document.getElementById(`forgotStep${i}`);
    if (el) el.classList.toggle('hidden', i !== stepNum);
  }
  // Update stepper pills
  for (let i = 1; i <= 4; i++) {
    const pill = document.getElementById(`stepPill${i}`);
    const line = document.getElementById(`stepLine${i}`);
    if (pill) {
      pill.classList.remove('active', 'completed');
      if (i === stepNum) pill.classList.add('active');
      else if (i < stepNum) pill.classList.add('completed');
    }
    if (line) {
      line.classList.toggle('active', i < stepNum);
    }
  }

  // Step-specific focus
  if (stepNum === 1) {
    const el = document.getElementById('forgotIdentifierInput');
    if (el) el.focus();
  } else if (stepNum === 3) {
    const firstDigit = document.querySelector('.otp-digit-group .otp-input');
    if (firstDigit) firstDigit.focus();
  } else if (stepNum === 4) {
    const newPw = document.getElementById('forgotNewPassword');
    if (newPw) newPw.focus();
  }
}

function fillForgotIdentifier(val) {
  const inp = document.getElementById('forgotIdentifierInput');
  if (inp) {
    inp.value = val;
    inp.focus();
  }
}

// Step 1: Look up account
async function handleForgotLookup(e) {
  if (e) e.preventDefault();
  const errBox = document.getElementById('forgotStep1Error');
  errBox.classList.add('hidden');
  const btn = document.getElementById('btnForgotFindAccount');
  const identifier = document.getElementById('forgotIdentifierInput').value.trim();

  if (!identifier) {
    errBox.innerText = 'Please enter your Student ID (or staff username).';
    errBox.classList.remove('hidden');
    return;
  }

  setBtnLoading(btn, true, 'Finding account...');
  try {
    const data = await apiRequest('POST', '/auth/forgot-password/lookup', { identifier });
    forgotState.identifier = identifier;
    forgotState.userType = data.userType;
    forgotState.userId = data.userId;
    forgotState.name = data.name;
    forgotState.rawEmail = data.email || '';
    forgotState.maskedEmail = data.maskedEmail || (data.email ? data.email : 'No email registered');
    forgotState.selectedMethod = 'email';

    // Populate Step 2
    const nameEl = document.getElementById('forgotMatchedName');
    if (nameEl) nameEl.innerText = data.name;

    const metaEl = document.getElementById('forgotMatchedMeta');
    if (metaEl) {
      metaEl.innerText = data.userType === 'student'
        ? `Student ID: ${data.userId}${data.course ? ` • ${data.course}` : ''}`
        : `Staff Account: ${data.userId}${data.department ? ` • ${data.department}` : ''}`;
    }

    const emailDest = document.getElementById('channelEmailDest');
    const btnSendOtp = document.getElementById('btnForgotSendOtp');
    const step2Err = document.getElementById('forgotStep2Error');
    if (step2Err) step2Err.classList.add('hidden');

    if (emailDest) {
      if (forgotState.rawEmail) {
        emailDest.innerText = forgotState.maskedEmail;
        emailDest.classList.remove('no-email-alert');
        if (btnSendOtp) btnSendOtp.disabled = false;
      } else {
        emailDest.innerText = 'No email registered on file';
        emailDest.classList.add('no-email-alert');
        if (btnSendOtp) btnSendOtp.disabled = true;
        if (step2Err) {
          step2Err.innerText = 'No recovery email registered for this account. Please sign in with your default password to set your recovery email, or visit the Registrar Office.';
          step2Err.classList.remove('hidden');
        }
      }
    }

    goToForgotStep(2);
  } catch (err) {
    errBox.innerText = err.message || 'No account found. Please check your Student ID, username, or registered email.';
    errBox.classList.remove('hidden');
  } finally {
    setBtnLoading(btn, false, '<span>Find Account</span> <i class="fa-solid fa-arrow-right"></i>');
  }
}

// Step 2 -> 3: Send Email OTP via MailJS
async function handleForgotSendOtp() {
  const errBox = document.getElementById('forgotStep2Error');
  errBox.classList.add('hidden');
  const btn = document.getElementById('btnForgotSendOtp');

  if (!forgotState.rawEmail) {
    errBox.innerText = 'No recovery email registered on file. Please sign in with your default password to set your email address, or contact the Registrar Office.';
    errBox.classList.remove('hidden');
    return;
  }

  setBtnLoading(btn, true, 'Sending Email OTP...');

  try {
    const resp = await apiRequest('POST', '/auth/forgot-password/send-otp', {
      identifier: forgotState.identifier,
      method: 'email'
    });

    forgotState.resetToken = resp.resetToken;
    forgotState.lastOtpCode = resp.otpCode;
    const destDisplay = resp.target || resp.rawTarget;
    const sentTarget = document.getElementById('forgotSentTarget');
    if (sentTarget) sentTarget.innerText = destDisplay;

    // Dispatch OTP via MailJS SDK
    await dispatchMailjsOtp(resp);

    clearOtpInputs();
    startOtpTimer(resp.expiresInSeconds || 600);
    startResendCooldown(30);
    goToForgotStep(3);
  } catch (err) {
    errBox.innerText = err.message || 'Failed to send OTP. Please try again.';
    errBox.classList.remove('hidden');
  } finally {
    setBtnLoading(btn, false, '<span>Send Email Verification Code</span> <i class="fa-solid fa-paper-plane"></i>');
  }
}

// MailJS (EmailJS) Client-Side Dispatcher
async function dispatchMailjsOtp(resp) {
  const localConfig = getStoredEmailjsConfig();
  const serviceId = resp.emailjsConfig?.serviceId || localConfig.serviceId || 'service_z32fcjw';
  const templateId = resp.emailjsConfig?.templateId || localConfig.templateId || 'template_0g2iuc7';
  const publicKey = resp.emailjsConfig?.publicKey || localConfig.publicKey || 'Fp31FCH9n5n2OIfyD';

  const recipient = resp.rawTarget;
  const userName = resp.userName || 'Student';
  const otpCode = resp.otpCode;

  // If EmailJS keys are provided, attempt real email send via EmailJS SDK
  if (templateId && publicKey && window.emailjs) {
    try {
      showDispatchNotice('info', '<i class="fa-solid fa-spinner fa-spin"></i> Sending email via MailJS to ' + (resp.target || recipient) + '...');

      const templateParams = {
        to_name: userName,
        user_name: userName,
        student_name: userName,
        recipient_name: userName,
        to_email: recipient,
        email: recipient,
        user_email: recipient,
        reply_to: 'noreply@wup.edu.ph',
        to: recipient,
        recipient: recipient,
        recipient_email: recipient,
        target_email: recipient,
        send_to: recipient,
        dest_email: recipient,
        otp_code: otpCode,
        otp: otpCode,
        code: otpCode,
        passcode: otpCode,
        title: `Verification Code: ${otpCode}`,
        subject: `Wesleyan University - Verification Code: ${otpCode}`,
        time: '10 minutes',
        time_limit: '10 minutes',
        from_name: 'Wesleyan University - Office of the Registrar',
        sender_name: 'Wesleyan University - Office of the Registrar',
        system_name: 'Wesleyan University - Office of the Registrar',
        message: `Your Wesleyan Registrar verification code is: ${otpCode}. Valid for 10 minutes. Do not share this code with anyone.`,
        app_name: 'Wesleyan University-Philippines Registrar System'
      };

      try {
        await window.emailjs.send(serviceId, templateId, templateParams, publicKey);
      } catch (firstErr) {
        // If initial service ID fails (e.g. service ID not found), retry with default_service alias
        if (serviceId !== 'default_service') {
          console.warn('MailJS service send failed, retrying with default_service alias...', firstErr);
          await window.emailjs.send('default_service', templateId, templateParams, publicKey);
        } else {
          throw firstErr;
        }
      }
      showDispatchNotice('success', '<i class="fa-solid fa-circle-check"></i> Email successfully sent via MailJS to <strong>' + (resp.target || recipient) + '</strong>! Please check inbox and spam folder.<br/><span style="display:inline-block;margin-top:5px;font-size:12px;opacity:0.9"><i class="fa-solid fa-circle-info"></i> If it doesn\'t arrive at ' + recipient + ', make sure your EmailJS Template <strong>To Email</strong> field is set to <code>{{to_email}}</code> in your <a href="https://dashboard.emailjs.com/admin/templates" target="_blank" rel="noopener" style="text-decoration:underline;color:inherit;font-weight:700">EmailJS Dashboard</a>.</span>');
      return;
    } catch (mailErr) {
      console.warn('EmailJS SDK send failed:', mailErr);
      showDispatchNotice('warning', `<i class="fa-solid fa-triangle-exclamation"></i> <strong>MailJS Notice:</strong> ${mailErr.text || mailErr.message || 'Could not send live email'}. <br/><strong>OTP Code for Testing:</strong> <span style="font-size:16px;font-weight:800;letter-spacing:1px">${otpCode}</span> <button type="button" class="channel-settings-btn" style="margin-left:8px" onclick="openEmailjsConfigModal(event)"><i class="fa-solid fa-sliders"></i> Check Keys</button>`);
      return;
    }
  }

  // Fallback test mode when keys are not configured yet
  showDispatchNotice('warning', `<i class="fa-solid fa-circle-info"></i> <strong>MailJS Test Mode:</strong> EmailJS keys not configured yet.<br/>Your verification OTP code is: <strong style="font-size:16px;color:var(--violet-deep);letter-spacing:2px">${otpCode}</strong> <button type="button" class="channel-settings-btn" style="margin-left:8px" onclick="openEmailjsConfigModal(event)"><i class="fa-solid fa-sliders"></i> Configure MailJS</button>`);
}

function showDispatchNotice(type, html) {
  const box = document.getElementById('forgotDispatchNotice');
  if (!box) return;
  box.className = `dispatch-notice ${type}`;
  box.innerHTML = html;
  box.classList.remove('hidden');
}

// Resend OTP
async function handleResendOtp() {
  const btn = document.getElementById('btnResendOtp');
  if (btn.disabled) return;
  await handleForgotSendOtp();
}

// 6-digit OTP Inputs Logic
function initOtpInputs() {
  const container = document.getElementById('otpDigitGroup');
  if (!container) return;
  const inputs = container.querySelectorAll('.otp-input');

  inputs.forEach((inp, idx) => {
    inp.addEventListener('input', (e) => {
      const val = inp.value.replace(/\D/g, '');
      inp.value = val ? val[0] : '';
      inp.classList.toggle('filled', !!inp.value);

      if (inp.value && idx < inputs.length - 1) {
        inputs[idx + 1].focus();
        inputs[idx + 1].select();
      }
      checkAutoSubmitOtp();
    });

    inp.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace' && !inp.value && idx > 0) {
        inputs[idx - 1].focus();
        inputs[idx - 1].value = '';
        inputs[idx - 1].classList.remove('filled');
      } else if (e.key === 'ArrowLeft' && idx > 0) {
        inputs[idx - 1].focus();
      } else if (e.key === 'ArrowRight' && idx < inputs.length - 1) {
        inputs[idx + 1].focus();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        handleForgotVerifyOtp();
      }
    });

    inp.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasteData = (e.clipboardData || window.clipboardData).getData('text').trim().replace(/\D/g, '');
      if (!pasteData) return;
      for (let i = 0; i < inputs.length; i++) {
        inputs[i].value = pasteData[i] || '';
        inputs[i].classList.toggle('filled', !!inputs[i].value);
      }
      const nextIdx = Math.min(pasteData.length, inputs.length - 1);
      inputs[nextIdx].focus();
      checkAutoSubmitOtp();
    });
  });
}

function clearOtpInputs() {
  const inputs = document.querySelectorAll('.otp-digit-group .otp-input');
  inputs.forEach(i => {
    i.value = '';
    i.classList.remove('filled');
  });
}

function getEnteredOtp() {
  const inputs = document.querySelectorAll('.otp-digit-group .otp-input');
  let code = '';
  inputs.forEach(i => code += (i.value || ''));
  return code;
}

function checkAutoSubmitOtp() {
  const code = getEnteredOtp();
  if (code.length === 6) {
    handleForgotVerifyOtp();
  }
}

// Step 3 -> 4: Verify OTP
async function handleForgotVerifyOtp() {
  const errBox = document.getElementById('forgotStep3Error');
  errBox.classList.add('hidden');
  const btn = document.getElementById('btnVerifyOtp');
  const otpCode = getEnteredOtp();

  if (otpCode.length !== 6) {
    errBox.innerText = 'Please enter all 6 digits of your verification code.';
    errBox.classList.remove('hidden');
    return;
  }

  setBtnLoading(btn, true, 'Verifying...');

  try {
    const data = await apiRequest('POST', '/auth/forgot-password/verify-otp', {
      resetToken: forgotState.resetToken,
      otpCode
    });

    forgotState.changeToken = data.changeToken;
    stopOtpTimer();
    goToForgotStep(4);
  } catch (err) {
    errBox.innerText = err.message || 'Invalid or expired verification code.';
    errBox.classList.remove('hidden');
    const group = document.getElementById('otpDigitGroup');
    if (group) {
      group.style.animation = 'fancyPulse 0.3s ease';
      setTimeout(() => group.style.animation = '', 300);
    }
  } finally {
    setBtnLoading(btn, false, '<span>Verify & Continue</span> <i class="fa-solid fa-check"></i>');
  }
}

// Step 4 -> 5: Save New Password
async function handleForgotResetPassword(e) {
  if (e) e.preventDefault();
  const errBox = document.getElementById('forgotStep4Error');
  errBox.classList.add('hidden');
  const btn = document.getElementById('btnForgotSavePw');

  const newPw = document.getElementById('forgotNewPassword').value;
  const confirmPw = document.getElementById('forgotConfirmPassword').value;

  if (newPw.length < 8) {
    errBox.innerText = 'Password must be at least 8 characters long.';
    errBox.classList.remove('hidden');
    return;
  }
  if (newPw !== confirmPw) {
    errBox.innerText = 'Passwords do not match.';
    errBox.classList.remove('hidden');
    return;
  }

  setBtnLoading(btn, true, 'Saving new password...');

  try {
    await apiRequest('POST', '/auth/forgot-password/reset-password', {
      changeToken: forgotState.changeToken,
      newPassword: newPw
    });

    goToForgotStep(5);
  } catch (err) {
    errBox.innerText = err.message || 'Could not reset password. Please try again.';
    errBox.classList.remove('hidden');
  } finally {
    setBtnLoading(btn, false, '<span>Save New Password</span> <i class="fa-solid fa-arrow-right"></i>');
  }
}

function finishForgotPasswordAndSignIn() {
  closeForgotPasswordInfo();
  const loginInput = document.getElementById('inputUsername');
  if (loginInput) {
    loginInput.value = forgotState.identifier;
  }
  const pwInput = document.getElementById('inputPassword');
  if (pwInput) {
    pwInput.value = '';
    pwInput.focus();
  }
}

// Password Eye Toggles
function toggleForgotPwVisibility(fieldId, btn) {
  const inp = document.getElementById(fieldId);
  if (!inp) return;
  const isPw = inp.type === 'password';
  inp.type = isPw ? 'text' : 'password';
  const icon = btn.querySelector('i');
  if (icon) {
    icon.className = isPw ? 'fa-regular fa-eye-slash' : 'fa-regular fa-eye';
  }
}

function resetForgotPwMeter() {
  document.querySelectorAll('#forgotPwMeterBar .pw-meter-segment').forEach(seg => {
    seg.className = 'pw-meter-segment';
  });
}

function updateForgotPwMeter() {
  const val = document.getElementById('forgotNewPassword').value;
  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  const cls = score <= 2 ? 'filled-weak' : score === 3 ? 'filled-mid' : 'filled-strong';
  document.querySelectorAll('#forgotPwMeterBar .pw-meter-segment').forEach((seg, i) => {
    seg.className = i < score ? `pw-meter-segment ${cls}` : 'pw-meter-segment';
  });
}

// Timers
function startOtpTimer(durationSec) {
  stopOtpTimer();
  forgotState.timerExpiresAt = Date.now() + durationSec * 1000;
  updateOtpTimerDisplay();
  forgotState.otpTimer = setInterval(updateOtpTimerDisplay, 1000);
}

function updateOtpTimerDisplay() {
  const remainingMs = forgotState.timerExpiresAt - Date.now();
  const label = document.getElementById('otpTimerDisplay');
  if (!label) return;

  if (remainingMs <= 0) {
    stopOtpTimer();
    label.innerHTML = '<span style="color:var(--bad)"><i class="fa-solid fa-circle-exclamation"></i> Code expired. Please request a new code.</span>';
    return;
  }
  const totalSec = Math.floor(remainingMs / 1000);
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  const mm = min < 10 ? '0' + min : min;
  const ss = sec < 10 ? '0' + sec : sec;
  label.innerHTML = `<i class="fa-regular fa-clock"></i> Code expires in: ${mm}:${ss}`;
}

function stopOtpTimer() {
  if (forgotState.otpTimer) clearInterval(forgotState.otpTimer);
  forgotState.otpTimer = null;
}

function startResendCooldown(sec) {
  stopResendTimer();
  const btn = document.getElementById('btnResendOtp');
  const countSpan = document.getElementById('resendCountdown');
  if (!btn || !countSpan) return;

  forgotState.resendCountdown = sec;
  btn.disabled = true;
  countSpan.innerText = forgotState.resendCountdown;

  forgotState.resendTimer = setInterval(() => {
    forgotState.resendCountdown--;
    if (forgotState.resendCountdown <= 0) {
      stopResendTimer();
      btn.disabled = false;
      btn.innerHTML = '<i class="fa-solid fa-rotate-right"></i> Resend Code';
    } else {
      countSpan.innerText = forgotState.resendCountdown;
    }
  }, 1000);
}

function stopResendTimer() {
  if (forgotState.resendTimer) clearInterval(forgotState.resendTimer);
  forgotState.resendTimer = null;
}



// EmailJS (MailJS) Configuration Modal
async function openEmailjsConfigModal(e) {
  if (e) e.stopPropagation();
  let cfg = getStoredEmailjsConfig();
  if (!cfg.publicKey && !cfg.serviceId) {
    try {
      const serverCfg = await apiRequest('GET', '/auth/emailjs-config');
      if (serverCfg) cfg = serverCfg;
    } catch (err) { }
  }
  document.getElementById('cfgEmailjsPublicKey').value = cfg.publicKey || '';
  document.getElementById('cfgEmailjsServiceId').value = cfg.serviceId || '';
  document.getElementById('cfgEmailjsTemplateId').value = cfg.templateId || '';
  hide('testEmailResult');
  show('modalEmailjsConfig');
}

function closeEmailjsConfigModal() {
  hide('modalEmailjsConfig');
}

function getStoredEmailjsConfig() {
  try {
    const raw = localStorage.getItem('wup_emailjs_config');
    const parsed = raw ? JSON.parse(raw) : {};
    if (parsed.templateId === 'template_6xxsq7i') {
      parsed.templateId = 'template_0g2iuc7';
      try { localStorage.setItem('wup_emailjs_config', JSON.stringify(parsed)); } catch (_) { }
    }
    if (parsed.serviceId === 'service_1rh5jvk') {
      parsed.serviceId = 'service_z32fcjw';
      try { localStorage.setItem('wup_emailjs_config', JSON.stringify(parsed)); } catch (_) { }
    }
    return parsed;
  } catch (e) {
    return {};
  }
}

async function handleSaveEmailjsConfig(e) {
  if (e) e.preventDefault();
  const publicKey = document.getElementById('cfgEmailjsPublicKey').value.trim();
  const serviceId = document.getElementById('cfgEmailjsServiceId').value.trim();
  const templateId = document.getElementById('cfgEmailjsTemplateId').value.trim();

  const cfg = { publicKey, serviceId, templateId };
  try {
    localStorage.setItem('wup_emailjs_config', JSON.stringify(cfg));
    await apiRequest('POST', '/auth/emailjs-config', cfg);
    closeEmailjsConfigModal();
    if (window.showFancyDialog) {
      showFancyDialog({
        title: 'Settings Saved',
        message: 'MailJS (EmailJS) configuration updated successfully.',
        icon: 'success'
      });
    } else {
      alert('MailJS (EmailJS) configuration updated successfully.');
    }
  } catch (err) {
    alert('Failed to save EmailJS settings: ' + err.message);
  }
}




async function sendTestEmailjs() {
  const resultBox = document.getElementById('testEmailResult');
  resultBox.classList.remove('hidden');
  resultBox.className = 'small';
  resultBox.innerHTML = '<span style="color:var(--violet)"><i class="fa-solid fa-spinner fa-spin"></i> Sending test email...</span>';

  const publicKey = document.getElementById('cfgEmailjsPublicKey').value.trim();
  const serviceId = document.getElementById('cfgEmailjsServiceId').value.trim();
  const templateId = document.getElementById('cfgEmailjsTemplateId').value.trim();
  const recipient = document.getElementById('testEmailRecipient').value.trim();

  if (!recipient || !recipient.includes('@')) {
    resultBox.innerHTML = '<span style="color:var(--bad)">Please enter a valid recipient email address.</span>';
    return;
  }
  if (!publicKey || !serviceId || !templateId) {
    resultBox.innerHTML = '<span style="color:var(--bad)">Please fill in Public Key, Service ID, and Template ID first.</span>';
    return;
  }

  if (!window.emailjs) {
    resultBox.innerHTML = '<span style="color:var(--bad)">EmailJS SDK is not loaded. Please check your internet connection.</span>';
    return;
  }

  try {
    const otpVal = Math.floor(100000 + Math.random() * 900000).toString();
    const testParams = {
      to_name: 'WUP User',
      user_name: 'WUP User',
      student_name: 'WUP User',
      recipient_name: 'WUP User',
      to_email: recipient,
      email: recipient,
      user_email: recipient,
      reply_to: 'noreply@wup.edu.ph',
      to: recipient,
      recipient: recipient,
      recipient_email: recipient,
      target_email: recipient,
      send_to: recipient,
      dest_email: recipient,
      otp_code: otpVal,
      otp: otpVal,
      code: otpVal,
      passcode: otpVal,
      title: `Verification Code: ${otpVal}`,
      subject: `Wesleyan University - Verification Code: ${otpVal}`,
      time: '10 minutes',
      time_limit: '10 minutes',
      from_name: 'Wesleyan University - Office of the Registrar',
      sender_name: 'Wesleyan University - Office of the Registrar',
      system_name: 'Wesleyan University - Office of the Registrar',
      message: `Your Wesleyan Registrar verification code is: ${otpVal}. Valid for 10 minutes. Do not share this code with anyone.`,
      app_name: 'WUP Registrar System Test'
    };
    try {
      await window.emailjs.send(serviceId, templateId, testParams, publicKey);
    } catch (firstErr) {
      if (serviceId !== 'default_service') {
        await window.emailjs.send('default_service', templateId, testParams, publicKey);
      } else {
        throw firstErr;
      }
    }
    resultBox.innerHTML = '<span style="color:var(--ok);font-weight:700"><i class="fa-solid fa-circle-check"></i> Test email successfully sent! Check ' + recipient + '.</span><br/><span style="font-size:11px;color:var(--ink-light);margin-top:4px;display:block">Note: If it went to your personal email instead of ' + recipient + ', remember to set <strong>To Email</strong> to <code>{{to_email}}</code> in your EmailJS template settings.</span>';
  } catch (err) {
    resultBox.innerHTML = '<span style="color:var(--bad)"><i class="fa-solid fa-circle-xmark"></i> Failed: ' + (err.text || err.message || JSON.stringify(err)) + '</span>';
  }
}

// Contact update for logged-in user
async function handleChangeContact(e) {
  if (e) e.preventDefault();
  const errBox = document.getElementById('contactError');
  const okBox = document.getElementById('contactSuccess');
  errBox.classList.add('hidden');
  okBox.classList.add('hidden');

  const email = document.getElementById('contactEmail').value.trim();
  const phoneNumber = document.getElementById('contactPhone').value.trim();
  const currentPassword = document.getElementById('contactPassword').value;

  try {
    const data = await apiRequest('POST', '/change-contact', { email, phoneNumber, currentPassword });
    currentUser.email = data.email;
    currentUser.phoneNumber = data.phoneNumber;
    document.getElementById('contactPassword').value = '';
    okBox.innerText = 'Contact information updated successfully.';
    okBox.classList.remove('hidden');
  } catch (err) {
    errBox.innerText = err.message || 'Could not update contact information.';
    errBox.classList.remove('hidden');
  }
}

// Button spinner helper
function setBtnLoading(btn, loading, html) {
  if (!btn) return;
  btn.disabled = loading;
  if (loading) {
    btn.dataset.origHtml = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> ${html || 'Processing...'}`;
  } else {
    btn.innerHTML = html || btn.dataset.origHtml || 'Submit';
  }
}

// ============================================================
// AUTH: SET A NEW PASSWORD (first login, or the account button)
// ============================================================
function handleRolePillClick() {
  if (!currentUser) return;
  closeMobileSidebar();
  openSetPasswordScreen(false);
}

// forced=true is used right after login when the account is still on its default
// password. It hides the Back button, so there is no way to skip the change.
function openSetPasswordScreen(forced) {
  forcedPasswordChange = !!forced;
  showingSetPassword = true;
  document.getElementById('setPasswordForm').reset();
  hide('setPwError');
  document.getElementById('usernameForm').reset();
  hide('unError'); hide('unSuccess');
  const cForm = document.getElementById('contactForm');
  if (cForm) cForm.reset();
  hide('contactError'); hide('contactSuccess');
  if (currentUser) {
    const pwEmail = document.getElementById('pwEmail');
    if (pwEmail) pwEmail.value = currentUser.email || '';
    const cEmail = document.getElementById('contactEmail');
    const cPhone = document.getElementById('contactPhone');
    if (cEmail) cEmail.value = currentUser.email || '';
    if (cPhone) cPhone.value = currentUser.phoneNumber || '';
  }
  const cSection = document.getElementById('contactSection');
  if (cSection) cSection.classList.toggle('hidden', forcedPasswordChange);
  resetPwMeter();
  renderApp();
}

function handleAuthBack() {
  if (forcedPasswordChange) return;
  showingSetPassword = false;
  renderApp();
}

function resetPwMeter() {
  document.querySelectorAll('#pwMeterBar .pw-meter-segment').forEach(seg => { seg.className = 'pw-meter-segment'; });
}

function updatePwMeter() {
  const val = document.getElementById('pwNew').value;
  let score = 0;
  if (val.length >= 8) score++;
  if (/[A-Z]/.test(val) && /[a-z]/.test(val)) score++;
  if (/[0-9]/.test(val)) score++;
  if (/[^A-Za-z0-9]/.test(val)) score++;
  const cls = score <= 2 ? 'filled-weak' : score === 3 ? 'filled-mid' : 'filled-strong';
  document.querySelectorAll('#pwMeterBar .pw-meter-segment').forEach((seg, i) => {
    seg.className = i < score ? `pw-meter-segment ${cls}` : 'pw-meter-segment';
  });
}

async function handleSetPasswordSubmit(e) {
  e.preventDefault();
  const errBox = document.getElementById('setPwError');
  errBox.classList.add('hidden');

  const currentPassword = document.getElementById('pwCurrent').value;
  const newPassword = document.getElementById('pwNew').value;
  const confirmPassword = document.getElementById('pwConfirm').value;
  const emailInput = document.getElementById('pwEmail');
  const email = (emailInput?.value || '').trim();

  const fail = (msg) => { errBox.innerText = msg; errBox.classList.remove('hidden'); };
  if (!email || !email.includes('@') || !email.includes('.')) {
    return fail('Please enter a valid recovery email address.');
  }
  if (newPassword.length < 8) return fail('New password must be at least 8 characters.');
  if (newPassword !== confirmPassword) return fail('New password and confirmation do not match.');

  try {
    const res = await apiRequest('POST', '/change-password', { currentPassword, newPassword, email });
    if (currentUser) {
      currentUser.email = res.email || email;
    }
    const cEmail = document.getElementById('contactEmail');
    if (cEmail) cEmail.value = res.email || email;
    show('modalPwUpdated');
  } catch (err) {
    fail(err.message || 'Could not update password.');
  }
}

async function handleChangeUsername(e) {
  e.preventDefault();
  const errBox = document.getElementById('unError');
  const okBox = document.getElementById('unSuccess');
  errBox.classList.add('hidden'); okBox.classList.add('hidden');
  const newUsername = document.getElementById('unNew').value.trim();
  const currentPassword = document.getElementById('unPassword').value;
  try {
    const updated = await apiRequest('POST', '/change-username', { newUsername, currentPassword });
    currentUser.username = updated.username;
    if (currentUser.role === 'staff') currentUser.id = updated.id;
    document.getElementById('usernameForm').reset();
    document.getElementById('currentUsernameLine').innerText = currentUser.role === 'staff'
      ? `Your current username is ${currentUser.username}.`
      : `Your WUP ID is ${currentUser.id}, and your username is ${currentUser.username}. You can sign in with either.`;
    okBox.innerText = 'Username updated. Use it the next time you sign in.';
    okBox.classList.remove('hidden');
  } catch (err) {
    errBox.innerText = err.message || 'Could not change the username.';
    errBox.classList.remove('hidden');
  }
}

async function closePwUpdatedModal() {
  hide('modalPwUpdated');
  const savedId = currentUser ? (currentUser.id || currentUser.username) : '';
  stopStaffAutoRefresh();
  try {
    await apiRequest('POST', '/logout');
  } catch (e) { }
  currentUser = null;
  requestsData = [];
  showingSetPassword = false;
  forcedPasswordChange = false;
  renderApp();

  const unInput = document.getElementById('inputUsername');
  if (unInput && savedId) {
    unInput.value = savedId;
  }
  const pwInput = document.getElementById('inputPassword');
  if (pwInput) {
    pwInput.value = '';
    pwInput.focus();
  }
}

// ============================================================
// ROOT RENDER
// ============================================================
function renderApp() {
  const authShell = document.getElementById('authShell');
  const appShell = document.getElementById('appShell');
  const authBackBtn = document.getElementById('authBackBtn');

  if (!currentUser || showingSetPassword) {
    authShell.classList.remove('hidden');
    appShell.classList.add('hidden');
    if (!currentUser) {
      show('viewLogin'); hide('viewSetPassword'); hide('authBackBtn');
      return;
    }
    hide('viewLogin'); show('viewSetPassword');
    document.getElementById('currentUsernameLine').innerText = currentUser.role === 'staff'
      ? `Your current username is ${currentUser.username || currentUser.id}.`
      : `Your WUP ID is ${currentUser.id}${currentUser.username ? `, and your username is ${currentUser.username}` : ''}. You can sign in with either.`;
    document.getElementById('usernameSection').classList.toggle('hidden', forcedPasswordChange);
    if (forcedPasswordChange) {
      hide('authBackBtn');
      show('requiredTag');
      document.getElementById('setPwIntro').innerText = "You're still using your default password. Set your own to continue.";
    } else {
      show('authBackBtn');
      hide('requiredTag');
      document.getElementById('setPwIntro').innerText = "Choose a password you haven't used before. You'll use it the next time you sign in.";
    }
    return;
  }

  authShell.classList.add('hidden');
  appShell.classList.remove('hidden');

  const isStaff = currentUser.role === 'staff';
  document.getElementById('roleBottomPillLabel').innerText = currentUser.name || (isStaff ? 'Registrar staff' : 'Student');
  document.getElementById('accountIcon').className = isStaff ? 'fa-solid fa-user-gear' : 'fa-solid fa-user';

  if (!isStaff) {
    document.getElementById('dispStudentId').innerText = currentUser.id;
    document.getElementById('dispStudentName').innerText = currentUser.name;
    document.getElementById('dispStudentCourse').innerText = currentUser.course;
  }
  renderSidebarNav();
  renderView();
}

function renderView() {
  ['viewStudent', 'viewStaff', 'viewDocuments', 'viewFees', 'viewReceipts'].forEach(hide);
  const isStaff = currentUser.role === 'staff';

  if (currentView === 'fees') {
    show('viewFees');
    renderFees();
  } else if (currentView === 'documents' && isStaff) {
    show('viewDocuments');
    renderDocuments();
  } else if (currentView === 'receipts' && isStaff) {
    show('viewReceipts');
    renderReceipts();
  } else if (isStaff) {
    currentView = 'requests';
    show('viewStaff');
    renderStaffDashboard();
  } else {
    currentView = 'requests';
    show('viewStudent');
    renderStudentDashboard();
  }
  document.getElementById('mainScroll').scrollTop = 0;
}

// ============================================================
// SIDEBAR
// ============================================================
function openMobileSidebar() {
  document.getElementById('sidebarAside').classList.add('mobile-open');
  show('sidebarBackdrop');
}
function closeMobileSidebar() {
  document.getElementById('sidebarAside').classList.remove('mobile-open');
  hide('sidebarBackdrop');
}

function navTo(view, filter) {
  currentView = view;
  if (filter) currentFilter = filter;
  localStorage.setItem('wup_current_view', currentView);
  localStorage.setItem('wup_current_filter', currentFilter);
  editingFeeId = null;
  renderSidebarNav();
  renderView();
  closeMobileSidebar();
}

function renderSidebarNav() {
  if (!currentUser) return;
  const isStaff = currentUser.role === 'staff';
  const count = (st) => requestsData.filter(r => r.status === st).length;

  const filters = [
    { key: 'all', label: 'All requests', icon: 'fa-box-archive' },
    { key: 'pending', label: 'Pending', icon: 'fa-hourglass-half', count: isStaff ? count('pending_verification') : 0 },
    { key: 'processing', label: 'Processing', icon: 'fa-print', count: isStaff ? count('processing') : 0 },
    { key: 'ready', label: 'Ready to claim', icon: 'fa-square-check', count: isStaff ? count('ready') : 0 },
    { key: 'claimed', label: 'Claimed', icon: 'fa-box' },
    { key: 'declined', label: 'Declined', icon: 'fa-file-circle-xmark' }
  ];
  const extra = isStaff
    ? [
      { view: 'documents', label: 'Documents', icon: 'fa-file-lines' },
      { view: 'fees', label: 'Clearance fees', icon: 'fa-peso-sign' },
      { view: 'receipts', label: 'Official receipts', icon: 'fa-receipt' }
    ]
    : [{ view: 'fees', label: 'Clearance fees', icon: 'fa-peso-sign' }];

  const btn = (active, onclick, icon, label, cnt) => `
    <button onclick="${onclick}" class="side-nav-item ${active ? 'active' : ''}"${active ? ' aria-current="page"' : ''}>
      <i class="fa-solid ${icon}"></i> ${label}${cnt ? `<span class="count">${cnt}</span>` : ''}
    </button>`;

  document.getElementById('sidebarNav').innerHTML =
    filters.map(f => btn(currentView === 'requests' && currentFilter === f.key, `navTo('requests','${f.key}')`, f.icon, f.label, f.count)).join('') +
    '<div class="nav-sep"></div>' +
    extra.map(x => btn(currentView === x.view, `navTo('${x.view}')`, x.icon, x.label)).join('');
}

function filterList(list) {
  switch (currentFilter) {
    case 'pending': return list.filter(r => r.status === 'pending_verification');
    case 'processing': return list.filter(r => r.status === 'processing');
    case 'ready': return list.filter(r => r.status === 'ready');
    case 'claimed': return list.filter(r => r.status === 'completed');
    case 'declined': return list.filter(r => r.status === 'declined');
    default: return list;
  }
}

// ============================================================
// STATUS BADGE + CLAIM DATE
// ============================================================
function getStatusBadge(st) {
  switch (st) {
    case 'pending_verification': return '<span class="badge pending"><i class="fa-solid fa-magnifying-glass"></i>Pending review</span>';
    case 'processing': return '<span class="badge processing"><i class="fa-solid fa-print"></i>Processing</span>';
    case 'ready': return '<span class="badge ready"><i class="fa-solid fa-circle-check"></i>Ready to claim</span>';
    case 'completed': return '<span class="badge completed"><i class="fa-solid fa-box"></i>Claimed</span>';
    case 'declined': return '<span class="badge declined"><i class="fa-solid fa-circle-xmark"></i>Declined</span>';
    default: return `<span class="badge completed">${esc(st)}</span>`;
  }
}

function calTile(iso, mini) {
  const p = dateParts(iso);
  return `<div class="cal ${mini ? 'mini' : ''}" aria-hidden="true">
    <div class="mon">${p.mon}</div><div class="day">${p.day}</div><div class="dow">${p.dow.slice(0, 3)}</div>
  </div>`;
}

// ============================================================
// STUDENT PORTAL
// ============================================================
function renderStudentDashboard() {
  const container = document.getElementById('studentRequestsContainer');
  const list = filterList(requestsData);

  if (list.length === 0) {
    const none = requestsData.length === 0;
    container.innerHTML = `
      <div class="panel empty">
        <i class="fa-solid fa-inbox"></i>
        <div class="t">${none ? 'No requests yet' : 'Nothing in this list'}</div>
        <div>${none ? 'Click the button below to file a document request.' : 'Requests with this status will show up here.'}</div>
        ${none ? '<button type="button" onclick="openNewRequestModal()" class="btn btn-primary" style="margin-top:16px"><i class="fa-solid fa-file-circle-plus"></i> New request</button>' : ''}
      </div>`;
    return;
  }

  container.innerHTML = list.map(req => {
    const processing = ['processing', 'ready', 'completed'].includes(req.status);
    const ready = ['ready', 'completed'].includes(req.status);
    const last = req.timeline[req.timeline.length - 1];

    const declined = req.status === 'declined';
    const current = ready ? 'ready' : processing ? 'processing' : 'filed';

    return `
    <article class="panel req-card">
      <div class="req-head">
        <div><span class="ref mono">${esc(req.ref)}</span> <span class="small muted">&nbsp;Requested ${esc(req.dateSubmitted)}</span></div>
        ${getStatusBadge(req.status)}
      </div>
      <div class="req-body">
        <div class="kv"><div class="k">Documents</div><div class="v">${itemsLabel(req)}</div></div>
        <div class="kv"><div class="k">Payment</div><div class="v mono">${esc(req.orNumber)}</div>
          <div class="small muted"><i class="fa-solid fa-paperclip"></i> Assessment Form attached</div></div>
        <div class="kv"><div class="k">Latest update</div><div class="v" style="font-weight:500">${esc(last ? last.title : '')}</div>
          ${req.status === 'declined' ? `<div class="decline-note">${esc(req.declineReason)}</div>` : ''}</div>
      </div>
      <div class="req-foot">
        <div class="tracker${declined ? ' is-declined' : ''}" aria-label="Progress">
          <div class="step done${current === 'filed' ? ' current' : ''}">Request filed</div>
          <div class="step${processing ? ' done' : ''}${current === 'processing' ? ' current' : ''}">In processing</div>
          <div class="step${ready ? ' done' : ''}${current === 'ready' ? ' current' : ''}">Ready to claim</div>
        </div>
      </div>
    </article>`;
  }).join('');
}

// ----- new request modal -----
async function openNewRequestModal() {
  try {
    requestableDocs = await apiRequest('GET', '/documents');
  } catch (err) {
    if (window.fancyAlert) {
      await fancyAlert('Could not load the document list: ' + err.message, 'Loading Error', 'danger');
    } else {
      alert('Could not load the document list: ' + err.message);
    }
    return;
  }
  selectedDocsMap = {};
  renderDocSelectionGrid();
  const or = document.getElementById('reqOrNumber');
  if (or) {
    or.value = '';
    clearOrState();
  }
  const fileInp = document.getElementById('fileAssessment');
  if (fileInp) fileInp.value = '';
  const fileLbl = document.getElementById('fileAssessmentLabel');
  if (fileLbl) fileLbl.innerText = 'Choose a file (JPG, PNG or PDF)';
  hide('assessmentPhotoPreviewContainer');
  show('assessmentUploadIcon');
  uploadedAssessmentPhotoData = '';
  show('modalNewRequest');
}

function closeNewRequestModal() { hide('modalNewRequest'); }

function renderDocSelectionGrid() {
  const grid = document.getElementById('docSelectionList');
  if (requestableDocs.length === 0) {
    grid.innerHTML = '<p class="muted small" style="grid-column:1/-1">No documents are open for request right now. Please check with the Office of Records.</p>';
    return;
  }
  grid.innerHTML = requestableDocs.map(doc => `
    <div class="doc-pick" id="pick-${doc.id}">
      <div>
        <div class="nm">${esc(doc.name)}</div>
        ${doc.description ? `<div class="ds">${esc(doc.description)}</div>` : ''}
      </div>
      <div class="qty">
        <span>Copies</span>
        <div class="ctl">
          <button type="button" onclick="adjustDocQuantity(${doc.id}, -1)" aria-label="Fewer copies of ${esc(doc.name)}">&minus;</button>
          <span id="qty-${doc.id}" class="n">0</span>
          <button type="button" onclick="adjustDocQuantity(${doc.id}, 1)" aria-label="More copies of ${esc(doc.name)}">+</button>
        </div>
      </div>
    </div>`).join('');
}

function adjustDocQuantity(id, delta) {
  const next = Math.min(20, Math.max(0, (selectedDocsMap[id] || 0) + delta));
  selectedDocsMap[id] = next;
  document.getElementById(`qty-${id}`).innerText = next;
  document.getElementById(`pick-${id}`).classList.toggle('on', next > 0);
}

function readUpload(input, labelId, previewWrapId, previewImgId, iconId, setter) {
  if (!(input.files && input.files[0])) return;
  const file = input.files[0];
  document.getElementById(labelId).innerText = `Attached: ${file.name}`;
  const reader = new FileReader();
  reader.onload = (e) => {
    setter(e.target.result);
    if (file.type.startsWith('image/')) {
      document.getElementById(previewImgId).src = e.target.result;
      show(previewWrapId); hide(iconId);
    } else {
      hide(previewWrapId); show(iconId);
    }
  };
  reader.readAsDataURL(file);
}
function handleAssessmentFileSelected(input) {
  readUpload(input, 'fileAssessmentLabel', 'assessmentPhotoPreviewContainer', 'assessmentPhotoPreview', 'assessmentUploadIcon', v => { uploadedAssessmentPhotoData = v; });
}

// ----- OR number: validation against official_receipts database -----
function clearOrState() {
  orUsed = false;
  orValid = false;
  const input = document.getElementById('reqOrNumber');
  const help = document.getElementById('orHelp');
  input.classList.remove('invalid', 'valid');
  help.classList.remove('error', 'valid');
  help.innerText = 'Enter the number printed on the receipt you got after paying at the Treasury.';
}

function showOrError(msg) {
  orUsed = false;
  orValid = false;
  const input = document.getElementById('reqOrNumber');
  const help = document.getElementById('orHelp');
  input.classList.remove('valid');
  input.classList.add('invalid');
  help.classList.remove('valid');
  help.classList.add('error');
  help.innerHTML = `<i class="fa-solid fa-circle-xmark"></i> ${esc(msg)}`;
}

function showOrValid(receipt) {
  orValid = true;
  orUsed = false;
  const input = document.getElementById('reqOrNumber');
  const help = document.getElementById('orHelp');
  input.classList.remove('invalid');
  input.classList.add('valid');
  help.classList.remove('error');
  help.classList.add('valid');
  const amt = receipt && receipt.amount > 0 ? ` — ₱${money(receipt.amount)}` : '';
  const desc = receipt && receipt.description ? ` (${esc(receipt.description)})` : '';
  help.innerHTML = `<i class="fa-solid fa-circle-check"></i> Valid Treasury receipt verified${amt}${desc}`;
}

function handleOrInput() {
  clearOrState();
  clearTimeout(orCheckTimer);
  const value = document.getElementById('reqOrNumber').value.trim();
  if (!value) return;
  const seq = ++orCheckSeq;
  orCheckTimer = setTimeout(async () => {
    try {
      const r = await apiRequest('GET', `/or-check?or=${encodeURIComponent(value)}`);
      if (seq !== orCheckSeq) return;
      if (r.error || !r.valid) {
        showOrError(r.error || 'Invalid Official Receipt (OR) number.');
      } else {
        showOrValid(r.receipt);
      }
    } catch (e) { /* the server checks again on submit */ }
  }, 350);
}

async function submitNewRequest() {
  const items = requestableDocs
    .filter(d => (selectedDocsMap[d.id] || 0) > 0)
    .map(d => ({ name: d.name, copies: selectedDocsMap[d.id] }));
  const orNumber = document.getElementById('reqOrNumber').value.trim();

  if (items.length === 0) {
    await fancyAlert('Please choose at least one document to request before proceeding.', 'No Document Selected', 'warning');
    return;
  }
  if (!orNumber) {
    await fancyAlert('Please enter your Official Receipt (OR) number issued by the Treasury.', 'OR Number Required', 'warning');
    return;
  }

  // Prevent student from proceeding if OR number is invalid or used!
  const help = document.getElementById('orHelp');
  if (help.classList.contains('error')) {
    await fancyAlert(help.innerText || 'The OR number you entered is invalid or already used.', 'Invalid Official Receipt', 'danger');
    document.getElementById('reqOrNumber').focus();
    return;
  }

  // Pre-validate with server if not yet verified
  if (!orValid) {
    try {
      const check = await apiRequest('GET', `/or-check?or=${encodeURIComponent(orNumber)}`);
      if (check.error || !check.valid) {
        showOrError(check.error || 'Invalid Official Receipt (OR) number.');
        await fancyAlert(check.error || 'Invalid Official Receipt (OR) number.', 'Invalid Official Receipt', 'danger');
        document.getElementById('reqOrNumber').focus();
        return;
      }
      orValid = true;
    } catch (err) {
      // server will check on POST
    }
  }

  if (!uploadedAssessmentPhotoData) {
    await fancyAlert('Please upload a photo of your Assessment Form to proceed.', 'Assessment Form Required', 'warning');
    return;
  }

  const btn = document.getElementById('submitRequestBtn');
  btn.disabled = true;
  try {
    const created = await apiRequest('POST', '/requests', {
      studentId: currentUser.id, items, orNumber,
      assessmentPhoto: uploadedAssessmentPhotoData
    });
    applyUpdatedRequest(created);
    closeNewRequestModal();
    document.getElementById('submittedRefDisplay').innerText = `Tracking reference: ${created.ref}`;
    show('modalRequestSubmitted');
    currentFilter = 'all';
    renderSidebarNav();
    renderStudentDashboard();
  } catch (err) {
    if (err.status === 409 || err.status === 400) {
      showOrError(err.message);
      await fancyAlert(err.message, 'Receipt Verification Failed', 'danger');
      document.getElementById('reqOrNumber').focus();
    } else {
      await fancyAlert('Could not submit the request: ' + err.message, 'Submission Failed', 'danger');
    }
  } finally {
    btn.disabled = false;
  }
}

function closeRequestSubmittedModal() { hide('modalRequestSubmitted'); }

// ============================================================
// STAFF: REQUEST QUEUE
// ============================================================
function renderStaffDashboard() {
  const n = (st) => requestsData.filter(r => r.status === st).length;
  document.getElementById('metricPending').innerText = n('pending_verification');
  document.getElementById('metricProcessing').innerText = n('processing');
  document.getElementById('metricReady').innerText = n('ready');
  document.getElementById('metricDeclined').innerText = n('declined');

  let list = filterList(requestsData);
  const search = (document.getElementById('staffSearchInput').value || '').trim().toLowerCase();
  if (search) {
    list = list.filter(r =>
      r.studentId.toLowerCase().includes(search) ||
      r.studentName.toLowerCase().includes(search) ||
      r.ref.toLowerCase().includes(search) ||
      r.orNumber.toLowerCase().includes(search));
  }

  const tbody = document.getElementById('staffTableBody');
  if (list.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="no-label" style="text-align:center;color:var(--muted);padding:40px 16px;display:table-cell">No requests match this view.</td></tr>`;
    return;
  }

  tbody.innerHTML = list.map(req => `
    <tr>
      <td data-label="Reference"><div style="text-align:inherit"><div class="cell-title mono" style="font-size:13px">${esc(req.ref)}</div>
        <div class="cell-sub">${esc(req.dateSubmitted)}</div></div></td>
      <td data-label="Student"><div style="text-align:inherit"><div class="cell-title">${esc(req.studentName)}</div>
        <div class="cell-sub mono">${esc(req.studentId)}</div></div></td>
      <td data-label="Documents" style="max-width:260px">${itemsLabel(req)}</td>
      <td data-label="OR number" class="mono" style="font-size:13px">${esc(req.orNumber)}</td>
      <td data-label="Status"><div style="text-align:inherit">${getStatusBadge(req.status)}
        ${req.status === 'ready' && req.claimDate ? `<div class="cell-sub" style="margin-top:4px">Claim on ${esc(dateParts(req.claimDate).full)}</div>` : ''}</div></td>
      <td class="actions"><button onclick="openStaffReviewModal('${esc(req.ref)}')" class="btn btn-ghost btn-sm"><i class="fa-solid fa-magnifying-glass"></i> Inspect</button></td>
    </tr>`).join('');
}

function previewBlock(photo, ref, openFn) {
  if (photo && photo.startsWith('data:image')) {
    return `<img class="preview" src="${photo}" alt="Uploaded file" onclick="${openFn}('${esc(ref)}')" />
      <button type="button" onclick="${openFn}('${esc(ref)}')" class="link-btn" style="display:block;margin:10px auto 0">Open full size</button>`;
  }
  if (photo) {
    return `<button type="button" onclick="${openFn}('${esc(ref)}')" class="link-btn"><i class="fa-solid fa-file-lines"></i> ${esc(photo.startsWith('data:') ? 'Open the uploaded file' : photo)}</button>`;
  }
  return '<div class="small muted"><i class="fa-solid fa-file-circle-xmark"></i> No file attached</div>';
}

function openStaffReviewModal(ref) {
  const req = requestsData.find(r => r.ref === ref);
  if (!req) return;
  currentActiveReviewRef = ref;

  document.getElementById('revModalHeader').innerText = `Review request ${req.ref}`;
  document.getElementById('revStudentName').innerText = req.studentName;
  document.getElementById('revStudentId').innerText = req.studentId;
  document.getElementById('revTrackingRef').innerText = req.ref;
  document.getElementById('revDate').innerText = req.dateSubmitted;
  if (req.orAmount != null) {
    document.getElementById('revOrNumber').innerHTML = `${esc(req.orNumber)} <span class="small muted" style="font-weight:400;margin-left:8px">(₱${money(req.orAmount)}${req.orDescription ? ' &bull; ' + esc(req.orDescription) : ''})</span>`;
  } else {
    document.getElementById('revOrNumber').innerText = req.orNumber;
  }

  const orBadge = document.getElementById('revOrBadge');
  if (req.status === 'pending_verification') { orBadge.innerText = 'Awaiting verification'; orBadge.className = 'badge pending'; }
  else if (req.status === 'declined') { orBadge.innerText = 'Declined'; orBadge.className = 'badge declined'; }
  else { orBadge.innerText = 'Verified'; orBadge.className = 'badge ready'; }

  // Attachment preview rendering
  if (!req.assessmentPhoto && req.hasAssessmentPhoto) {
    document.getElementById('revAssessmentContainer').innerHTML =
      '<div class="small muted" style="padding:10px 0"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading attachment...</div>';
  } else {
    document.getElementById('revAssessmentContainer').innerHTML = previewBlock(req.assessmentPhoto, req.ref, 'openAssessmentFullPreview');
  }

  if (req.clearancePhoto) {
    show('revClearanceBox');
    document.getElementById('revClearanceContainer').innerHTML = previewBlock(req.clearancePhoto, req.ref, 'openClearanceFullPreview');
  } else if (!req.clearancePhoto && req.hasClearancePhoto) {
    show('revClearanceBox');
    document.getElementById('revClearanceContainer').innerHTML =
      '<div class="small muted" style="padding:10px 0"><i class="fa-solid fa-circle-notch fa-spin"></i> Loading attachment...</div>';
  } else {
    hide('revClearanceBox');
    document.getElementById('revClearanceContainer').innerHTML = '';
  }

  document.getElementById('revDocsList').innerHTML = req.items.map(i =>
    `<div class="doc-line">${i.copies}x ${esc(i.name)}</div>`).join('');

  if (req.status === 'ready' && req.claimDate) {
    const p = dateParts(req.claimDate);
    show('revClaimBox');
    document.getElementById('revClaimContent').innerHTML =
      `<div class="claim" style="margin:0">${calTile(req.claimDate, true)}<div class="txt"><div class="big" style="font-size:16px">${esc(p.dow)}, ${esc(p.full)}</div></div></div>`;
  } else {
    hide('revClaimBox');
  }

  if (req.status === 'declined') {
    show('revDeclineReasonBox');
    document.getElementById('revDeclineReasonText').innerText = req.declineReason;
  } else {
    hide('revDeclineReasonBox');
  }

  document.getElementById('revTimeline').innerHTML = req.timeline.map(t =>
    `<li>${esc(t.title)}<div class="t">${esc(t.time)}</div></li>`).join('');

  // Declining is only possible before verification begins.
  document.getElementById('revDeclineBtn').classList.toggle('hidden', req.status !== 'pending_verification');

  const actions = document.getElementById('revActionButtons');
  if (req.status === 'pending_verification') {
    actions.innerHTML = `<button onclick="openGradesNotice('${esc(req.ref)}')" class="btn btn-primary"><i class="fa-solid fa-check"></i> Verify and begin processing</button>`;
  } else if (req.status === 'processing') {
    actions.innerHTML = `<button onclick="openReadyModal('${esc(req.ref)}', false)" class="btn btn-primary"><i class="fa-solid fa-box-archive"></i> Mark as ready to claim</button>`;
  } else if (req.status === 'ready') {
    actions.innerHTML = `
      <button onclick="openReadyModal('${esc(req.ref)}', true)" class="btn btn-ghost"><i class="fa-solid fa-calendar-day"></i> Change claim date</button>
      <button onclick="staffMarkCompleted('${esc(req.ref)}')" class="btn btn-primary"><i class="fa-solid fa-check-double"></i> Mark as claimed</button>`;
  } else {
    actions.innerHTML = '<span class="small muted" style="font-weight:600">Request closed</span>';
  }

  show('modalStaffReview');

  // Asynchronously load attachments if not already loaded in memory
  if ((!req.assessmentPhoto && req.hasAssessmentPhoto) || (!req.clearancePhoto && req.hasClearancePhoto)) {
    apiRequest('GET', `/requests/lookup/${encodeURIComponent(ref)}`).then(full => {
      if (!full) return;
      req.assessmentPhoto = full.assessmentPhoto;
      req.clearancePhoto = full.clearancePhoto;
      if (currentActiveReviewRef === ref) {
        document.getElementById('revAssessmentContainer').innerHTML = previewBlock(req.assessmentPhoto, req.ref, 'openAssessmentFullPreview');
        if (req.clearancePhoto) {
          show('revClearanceBox');
          document.getElementById('revClearanceContainer').innerHTML = previewBlock(req.clearancePhoto, req.ref, 'openClearanceFullPreview');
        } else {
          hide('revClearanceBox');
          document.getElementById('revClearanceContainer').innerHTML = '';
        }
      }
    }).catch(e => {
      console.warn('Failed to load request attachment:', e);
    });
  }
}

function closeStaffReviewModal() { hide('modalStaffReview'); }

function openFullPreview(photo, title, ref) {
  if (!photo) return;
  const win = window.open();
  if (!win) { fancyAlert('Allow pop-ups for this site to open the file preview.', 'Pop-up Blocked', 'info'); return; }
  if (photo.startsWith('data:image')) {
    win.document.write(`<title>${title} - ${ref}</title><body style="margin:0;background:#111;display:flex;align-items:center;justify-content:center;min-height:100vh;"><img src="${photo}" style="max-width:100%;max-height:100vh;"/></body>`);
  } else if (photo.startsWith('data:')) {
    win.location.href = photo;
  } else {
    win.document.write(`<title>${title} - ${ref}</title><body style="font-family:sans-serif;padding:2rem;">No previewable file was attached for this request.</body>`);
  }
}
async function openAssessmentFullPreview(ref) {
  let req = requestsData.find(r => r.ref === ref);
  if (!req) return;
  if (!req.assessmentPhoto && req.hasAssessmentPhoto) {
    try {
      const full = await apiRequest('GET', `/requests/lookup/${encodeURIComponent(ref)}`);
      if (full) {
        req.assessmentPhoto = full.assessmentPhoto;
        req.clearancePhoto = full.clearancePhoto;
      }
    } catch (e) {}
  }
  openFullPreview(req.assessmentPhoto, 'Assessment Form', req.ref);
}
async function openClearanceFullPreview(ref) {
  let req = requestsData.find(r => r.ref === ref);
  if (!req) return;
  if (!req.clearancePhoto && req.hasClearancePhoto) {
    try {
      const full = await apiRequest('GET', `/requests/lookup/${encodeURIComponent(ref)}`);
      if (full) {
        req.assessmentPhoto = full.assessmentPhoto;
        req.clearancePhoto = full.clearancePhoto;
      }
    } catch (e) {}
  }
  openFullPreview(req.clearancePhoto, 'Clearance Requirement', req.ref);
}

// ----- status actions -----
async function runStaffAction(path, body) {
  try {
    const updated = await apiRequest('POST', path, body);
    applyUpdatedRequest(updated);
    return true;
  } catch (err) {
    await fancyAlert('Action failed: ' + err.message, 'Action Failed', 'danger');
    // the request may have changed under us; reload so the screen is truthful
    try { await refreshRequestsData(); } catch (e) { /* ignore */ }
    return false;
  } finally {
    closeStaffReviewModal();
    renderSidebarNav();
    renderStaffDashboard();
  }
}

// Pending Review: the Wesleyan Automate reminder shows here, once, before processing begins (only for documents with grades).
function openGradesNotice(ref) {
  const req = requestsData.find(r => r.ref === ref);
  if (!req) return;
  const isGradesDoc = (name) => {
    const n = (name || '').toLowerCase();
    if (n.includes('enrollment') || n === 'coe' || n === 'ceo') return false;
    return n.includes('grade') || n.includes('transcript');
  };
  const applies = req.items.some(i => isGradesDoc(i.name));
  if (!applies) { runStaffAction(`/requests/${encodeURIComponent(ref)}/approve-payment`); return; }
  pendingGradesRef = ref;
  show('modalGradesNotice');
}
function closeGradesNotice() { hide('modalGradesNotice'); pendingGradesRef = null; }
async function confirmGradesNotice() {
  const ref = pendingGradesRef;
  closeGradesNotice();
  if (ref) await runStaffAction(`/requests/${encodeURIComponent(ref)}/approve-payment`);
}

// Ready to claim: the registrar picks the claim date (no past dates). Also used to change it later.
function openReadyModal(ref, isChange) {
  const req = requestsData.find(r => r.ref === ref);
  if (!req) return;
  readyModalRef = ref;
  readyModalIsChange = !!isChange;
  document.getElementById('readyTitle').innerText = isChange ? 'Change the claim date' : 'Set the claim date';
  document.getElementById('readyConfirmBtn').innerText = isChange ? 'Save claim date' : 'Mark as ready to claim';
  const input = document.getElementById('readyDate');
  input.min = todayLocal();
  input.value = isChange && req.claimDate ? req.claimDate : '';
  hide('readyError');
  show('modalReady');
}
function closeReadyModal() { hide('modalReady'); readyModalRef = null; }
async function confirmReadyModal() {
  const date = document.getElementById('readyDate').value;
  const err = document.getElementById('readyError');
  const fail = (m) => { err.innerText = m; err.classList.remove('hidden'); };
  if (!date) return fail('Pick a claim date.');
  if (date < todayLocal()) return fail('The claim date cannot be in the past.');

  const ref = readyModalRef;
  const path = readyModalIsChange ? 'claim-date' : 'mark-ready';
  try {
    const updated = await apiRequest('POST', `/requests/${encodeURIComponent(ref)}/${path}`, { claimDate: date });
    applyUpdatedRequest(updated);
  } catch (e) {
    return fail(e.message);
  }
  closeReadyModal();
  closeStaffReviewModal();
  renderSidebarNav();
  renderStaffDashboard();
}

async function staffMarkCompleted(ref) {
  await runStaffAction(`/requests/${encodeURIComponent(ref)}/mark-completed`);
}

// ----- decline -----
function promptDeclineModal() {
  document.getElementById('declinePreset').value = '';
  document.getElementById('declineCustomText').value = '';
  show('modalDecline');
}
function closeDeclinePrompt() { hide('modalDecline'); }
function applyDeclinePreset(val) {
  if (val) document.getElementById('declineCustomText').value = val;
}
async function confirmDecline() {
  const reason = document.getElementById('declineCustomText').value.trim();
  if (!reason) {
    await fancyAlert('Please write a reason for declining this request.', 'Decline Reason Required', 'warning');
    return;
  }
  closeDeclinePrompt();
  await runStaffAction(`/requests/${encodeURIComponent(currentActiveReviewRef)}/decline`, { reason });
}

// ============================================================
// CLEARANCE FEES (students read, registrar edits)
// ============================================================
function renderFees() {
  const isStaff = currentUser.role === 'staff';
  document.getElementById('feesIntro').innerText = isStaff
    ? 'The price list students see. Edit a fee when the Treasury changes it.'
    : 'What each document costs. Pay at the Treasury, then enter the OR number the Treasury gives you when you file your request.';
  document.getElementById('feesActionHead').style.display = isStaff ? '' : 'none';
  document.getElementById('feesStatusHead').style.display = isStaff ? '' : 'none';
  const cols = isStaff ? 4 : 2;

  const body = document.getElementById('feesBody');
  if (feesData.length === 0) {
    body.innerHTML = `<tr><td colspan="${cols}" style="text-align:center;color:var(--muted);padding:32px;display:table-cell">No fees listed yet.</td></tr>`;
    return;
  }

  body.innerHTML = feesData.map(f => {
    const editing = isStaff && editingFeeId === f.id;
    const priceCell = editing
      ? `<input type="number" id="feeInput-${f.id}" class="input price-input" min="0" step="0.01" value="${Number(f.price).toFixed(2)}" onkeydown="if(event.key==='Enter')saveFee(${f.id});if(event.key==='Escape')cancelFeeEdit()" aria-label="Fee for ${esc(f.name)}" />`
      : `<span class="price">&#8369;${money(f.price)}</span>`;
    const action = !isStaff ? '' : editing
      ? `<td class="actions"><button class="btn btn-primary btn-sm" onclick="saveFee(${f.id})">Save</button> <button class="btn btn-ghost btn-sm" onclick="cancelFeeEdit()">Cancel</button></td>`
      : `<td class="actions"><button class="btn btn-ghost btn-sm" onclick="editFee(${f.id})"><i class="fa-solid fa-pen"></i> Edit</button> <button class="btn btn-danger-ghost btn-sm" onclick="deleteFee(${f.id})"><i class="fa-solid fa-trash"></i> Delete</button></td>`;
    const doc = documentsData.find(d => d.name === f.name);
    const online = doc && doc.active
      ? '<span class="badge ready"><i class="fa-solid fa-circle-check"></i>Students can request</span>'
      : '<span class="small muted">Reference only</span>';
    const statusCell = isStaff ? `<td data-label="Online request">${online}</td>` : '';
    return `<tr><td data-label="Document" class="cell-title">${esc(f.name)}</td>${statusCell}<td data-label="Fee" class="num">${priceCell}</td>${action}</tr>`;
  }).join('');

  if (editingFeeId) {
    const el = document.getElementById(`feeInput-${editingFeeId}`);
    if (el) { el.focus(); el.select(); }
  }
}
function editFee(id) { editingFeeId = id; renderFees(); }
function cancelFeeEdit() { editingFeeId = null; renderFees(); }
async function deleteFee(id) {
  const fee = feesData.find(f => f.id === id);
  if (!fee) return;
  const confirmed = await fancyConfirm(
    `Delete "${fee.name}" from Clearance fees?\n\nThis only removes the price. Any document with this name is not deleted.`,
    'Delete Clearance Fee',
    { confirmText: 'Delete Fee', cancelText: 'Cancel', type: 'danger', dangerConfirm: true }
  );
  if (!confirmed) return;
  try {
    await apiRequest('DELETE', `/fees/${id}`);
    feesData = feesData.filter(f => f.id !== id);
    if (editingFeeId === id) editingFeeId = null;
    renderFees();
  } catch (err) {
    await fancyAlert('Could not delete the fee: ' + err.message, 'Delete Failed', 'danger');
  }
}
async function saveFee(id) {
  const value = document.getElementById(`feeInput-${id}`).value;
  if (value === '' || Number(value) < 0) {
    await fancyAlert('Enter a price of 0 or more.', 'Invalid Fee Price', 'warning');
    return;
  }
  try {
    const updated = await apiRequest('PATCH', `/fees/${id}`, { price: Number(value) });
    const idx = feesData.findIndex(f => f.id === id);
    if (idx >= 0) feesData[idx] = updated;
    editingFeeId = null;
    renderFees();
  } catch (err) {
    await fancyAlert('Could not save the fee: ' + err.message, 'Save Failed', 'danger');
  }
}

// ============================================================
// DOCUMENTS (registrar only)
// ============================================================
function renderDocuments() {
  const body = document.getElementById('documentsBody');
  if (documentsData.length === 0) {
    body.innerHTML = `<tr><td colspan="4" style="text-align:center;color:var(--muted);padding:32px;display:table-cell">No documents yet. Choose Add document to create one.</td></tr>`;
    return;
  }
  body.innerHTML = documentsData.map(d => `
    <tr>
      <td data-label="Document" class="cell-title">${esc(d.name)}</td>
      <td data-label="Description" class="muted small" style="max-width:320px">${d.description ? esc(d.description) : '&mdash;'}</td>
      <td data-label="Available to students">
        <span style="display:inline-flex;align-items:center;gap:10px">
          <button class="switch" role="switch" aria-checked="${d.active}" aria-label="${esc(d.name)} available to students" onclick="toggleDocument(${d.id})"></button>
          <span class="badge ${d.active ? 'on' : 'off'}">${d.active ? 'Available' : 'Hidden'}</span>
        </span>
      </td>
      <td class="actions"><button class="btn btn-ghost btn-sm" onclick="openDocForm(${d.id})"><i class="fa-solid fa-pen"></i> Edit</button>
        <button class="btn btn-danger-ghost btn-sm" onclick="deleteDocument(${d.id})"><i class="fa-solid fa-trash"></i> Delete</button></td>
    </tr>`).join('');
}

async function deleteDocument(id) {
  const doc = documentsData.find(d => d.id === id);
  if (!doc) return;
  const confirmed = await fancyConfirm(
    `Delete "${doc.name}"?\n\nIt will also be removed from Clearance fees. Past requests keep their records.`,
    'Delete Document',
    { confirmText: 'Delete Document', cancelText: 'Cancel', type: 'danger', dangerConfirm: true }
  );
  if (!confirmed) return;
  try {
    await apiRequest('DELETE', `/documents/${id}`);
    documentsData = documentsData.filter(d => d.id !== id);
    feesData = feesData.filter(f => f.name !== doc.name);
    renderDocuments();
  } catch (err) {
    await fancyAlert('Could not delete the document: ' + err.message, 'Delete Failed', 'danger');
  }
}

async function toggleDocument(id) {
  const doc = documentsData.find(d => d.id === id);
  if (!doc) return;
  try {
    const updated = await apiRequest('PATCH', `/documents/${id}`, { active: !doc.active });
    documentsData[documentsData.findIndex(d => d.id === id)] = updated;
    renderDocuments();
  } catch (err) {
    await fancyAlert('Could not update the document: ' + err.message, 'Update Failed', 'danger');
  }
}

function openDocForm(id) {
  editingDocId = id;
  const doc = id ? documentsData.find(d => d.id === id) : null;
  document.getElementById('docFormTitle').innerText = doc ? 'Edit document' : 'Add document';
  document.getElementById('docFormSave').innerText = doc ? 'Save changes' : 'Add document';
  document.getElementById('docName').value = doc ? doc.name : '';
  document.getElementById('docDescription').value = doc ? doc.description : '';
  document.getElementById('docFormNote').classList.toggle('hidden', !!doc);
  hide('docFormError');
  show('modalDocForm');
  document.getElementById('docName').focus();
}
function closeDocForm() { hide('modalDocForm'); editingDocId = null; }

async function saveDocForm() {
  const name = document.getElementById('docName').value.trim();
  const description = document.getElementById('docDescription').value.trim();
  const err = document.getElementById('docFormError');
  if (!name) { err.innerText = 'Enter a document name.'; err.classList.remove('hidden'); return; }

  try {
    if (editingDocId) {
      const updated = await apiRequest('PATCH', `/documents/${editingDocId}`, { name, description });
      documentsData[documentsData.findIndex(d => d.id === editingDocId)] = updated;
    } else {
      const created = await apiRequest('POST', '/documents', { name, description });
      documentsData.push(created);
    }
    await loadFees(); // a new or renamed document changes the fee list
    closeDocForm();
    renderDocuments();
  } catch (e) {
    err.innerText = e.message;
    err.classList.remove('hidden');
  }
}

// ============================================================
// OFFICIAL RECEIPTS (Treasury Records - Staff Only)
// ============================================================
function renderReceipts() {
  const body = document.getElementById('receiptsBody');
  const countEl = document.getElementById('receiptsCountSummary');
  if (!body) return;

  const q = receiptSearchQuery.toLowerCase();
  const filtered = receiptsData.filter(r =>
    !q ||
    r.orNumber.toLowerCase().includes(q) ||
    (r.studentId && r.studentId.toLowerCase().includes(q)) ||
    (r.studentName && r.studentName.toLowerCase().includes(q)) ||
    (r.description && r.description.toLowerCase().includes(q))
  );

  const availableCount = receiptsData.filter(r => !r.isUsed).length;
  if (countEl) countEl.innerText = `${receiptsData.length} total receipts (${availableCount} available)`;

  if (filtered.length === 0) {
    body.innerHTML = '<tr><td colspan="7" style="text-align:center;color:var(--muted);padding:32px;display:table-cell">No receipts found.</td></tr>';
    return;
  }

  body.innerHTML = filtered.map(r => {
    const studentInfo = r.studentId
      ? `<div><b>${esc(r.studentName || r.studentId)}</b><div class="small muted mono">${esc(r.studentId)}</div></div>`
      : '<span class="small muted mono">—</span>';

    let statusBadge = '<span class="badge ready"><i class="fa-solid fa-circle-check"></i>Available</span>';
    if (r.isUsed) {
      statusBadge = `<span class="badge pending"><i class="fa-solid fa-file"></i>Used in <b>${esc(r.usedRef)}</b></span>`;
    }

    const action = r.isUsed
      ? ''
      : `<button class="btn btn-danger-ghost btn-sm" onclick="deleteReceipt('${esc(r.orNumber)}')"><i class="fa-solid fa-trash"></i> Delete</button>`;

    return `
      <tr>
        <td data-label="OR Number" class="mono cell-title" style="font-weight:700">${esc(r.orNumber)}</td>
        <td data-label="Payor">${studentInfo}</td>
        <td data-label="Amount" class="num price">&#8369;${money(r.amount)}</td>
        <td data-label="Particulars" class="small">${esc(r.description || 'Treasury Receipt')}</td>
        <td data-label="Date Issued" class="small muted">${esc(r.dateIssued || '')}</td>
        <td data-label="Status">${statusBadge}</td>
        <td class="actions">${action}</td>
      </tr>
    `;
  }).join('');
}

function handleReceiptSearch(val) {
  receiptSearchQuery = String(val || '').trim();
  renderReceipts();
}


async function fetchNextOrForStaff() {
  try {
    const res = await apiRequest('GET', '/receipts/next-or');
    if (res && res.orNumber) {
      document.getElementById('recOrNumber').value = res.orNumber;
    }
  } catch (err) {
    console.error('Could not fetch next OR:', err);
  }
}

async function openReceiptForm() {
  document.getElementById('recOrNumber').value = '';
  document.getElementById('recStudentId').value = '';
  document.getElementById('recStudentName').value = '';
  document.getElementById('recAmount').value = '150';
  document.getElementById('recDateIssued').value = todayLocal();
  document.getElementById('recDescription').value = 'Document Request Fee';
  const help = document.getElementById('recStudentHelp');
  if (help) {
    help.className = 'help xs';
    help.innerText = 'Required. Enter the student\'s official university ID.';
  }
  hide('receiptFormError');
  show('modalReceiptForm');
  await fetchNextOrForStaff();
  document.getElementById('recStudentId').focus();
}

async function lookupStudentForReceipt(rawId) {
  const id = String(rawId || '').trim().toUpperCase();
  const help = document.getElementById('recStudentHelp');
  const nameInput = document.getElementById('recStudentName');
  if (!id) {
    if (help) {
      help.className = 'help xs';
      help.innerText = 'Required. Enter the student\'s official university ID.';
    }
    return;
  }
  try {
    const student = await apiRequest('GET', `/students/${encodeURIComponent(id)}`);
    if (student && student.name) {
      if (nameInput && !nameInput.value.trim()) {
        nameInput.value = student.name;
      }
      if (help) {
        help.className = 'help xs valid';
        help.innerHTML = `<i class="fa-solid fa-circle-check"></i> Found: <b>${esc(student.name)}</b> (${esc(student.course)})`;
      }
    }
  } catch (err) {
    if (help) {
      help.className = 'help xs error';
      help.innerText = `Student "${id}" was not found in records.`;
    }
  }
}

function closeReceiptForm() {
  hide('modalReceiptForm');
}

async function saveNewReceipt() {
  const orNumber = document.getElementById('recOrNumber').value.trim();
  const studentId = document.getElementById('recStudentId').value.trim();
  const studentName = document.getElementById('recStudentName').value.trim();
  const amount = Number(document.getElementById('recAmount').value);
  const dateIssued = document.getElementById('recDateIssued').value;
  const description = document.getElementById('recDescription').value.trim();
  const errBox = document.getElementById('receiptFormError');

  if (!studentId) {
    errBox.innerText = 'Student ID is required to add an Official Receipt.';
    errBox.classList.remove('hidden');
    document.getElementById('recStudentId').focus();
    return;
  }

  if (!orNumber) {
    errBox.innerText = 'Please enter an Official Receipt (OR) number.';
    errBox.classList.remove('hidden');
    document.getElementById('recOrNumber').focus();
    return;
  }

  const btn = document.getElementById('saveReceiptBtn');
  btn.disabled = true;
  try {
    const created = await apiRequest('POST', '/receipts', {
      orNumber, studentId, studentName, amount, dateIssued, description
    });
    receiptsData.unshift({
      orNumber: created.or_number,
      studentId: created.student_id,
      studentName: created.student_name,
      amount: created.amount,
      description: created.description,
      dateIssued: created.date_issued,
      isUsed: false,
      usedRef: '',
      usedByStudent: '',
      requestStatus: ''
    });
    closeReceiptForm();
    renderReceipts();
  } catch (err) {
    errBox.innerText = err.message;
    errBox.classList.remove('hidden');
  } finally {
    btn.disabled = false;
  }
}

async function deleteReceipt(orNumber) {
  const confirmed = await fancyConfirm(
    `Delete Official Receipt ${orNumber} from Treasury records? This record will no longer be available for student requests.`,
    'Delete Official Receipt',
    { confirmText: 'Delete Receipt', cancelText: 'Cancel', type: 'danger', dangerConfirm: true }
  );
  if (!confirmed) return;
  try {
    await apiRequest('DELETE', `/receipts/${encodeURIComponent(orNumber)}`);
    receiptsData = receiptsData.filter(r => r.orNumber.toUpperCase() !== orNumber.toUpperCase());
    renderReceipts();
  } catch (err) {
    await fancyAlert('Could not delete receipt: ' + err.message, 'Delete Failed', 'danger');
  }
}
