// scanner.js — all logic for scanner.html

const MODES = {
  in:       { label: 'Stock IN',   color: '#22c55e', needsQty: true,  needsPerson: false },
  out:      { label: 'Stock OUT',  color: '#f97316', needsQty: true,  needsPerson: false },
  checkout: { label: 'Check Out',  color: '#a855f7', needsQty: false, needsPerson: true  },
  checkin:  { label: 'Check In',   color: '#3b82f6', needsQty: false, needsPerson: false },
  lookup:   { label: 'Lookup',     color: '#64748b', needsQty: false, needsPerson: false },
};

let currentMode   = 'lookup';
let scanHistory   = [];
let lastScanTime  = 0;
let cameraActive  = false;
let html5QrScanner = null;
let currentUser   = null;

// ── Audio ────────────────────────────────────────────────────
const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

function beep(freq = 880, duration = 120, type = 'sine', gain = 0.3) {
  const osc = audioCtx.createOscillator();
  const vol = audioCtx.createGain();
  osc.connect(vol);
  vol.connect(audioCtx.destination);
  osc.frequency.value = freq;
  osc.type = type;
  vol.gain.setValueAtTime(gain, audioCtx.currentTime);
  vol.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + duration / 1000);
  osc.start(audioCtx.currentTime);
  osc.stop(audioCtx.currentTime + duration / 1000);
}

function beepSuccess() { beep(880, 100); setTimeout(() => beep(1320, 120), 110); }
function beepError()   { beep(220, 300, 'sawtooth', 0.25); }

// ── Init ─────────────────────────────────────────────────────
async function init() {
  currentUser = await auth.requireAuth();
  if (!currentUser) return;

  document.getElementById('userLabel').textContent = currentUser.username;
  if (currentUser.role === 'admin') {
    document.getElementById('adminLinks').style.display = 'flex';
  }

  setMode('lookup');
  refocusBarcodeInput();

  document.getElementById('logoutBtn').addEventListener('click', auth.logout);
  document.getElementById('barcodeInput').addEventListener('keydown', onBarcodeKeydown);
  document.getElementById('cameraToggle').addEventListener('change', onCameraToggle);

  document.querySelectorAll('.mode-btn').forEach(btn => {
    btn.addEventListener('click', () => setMode(btn.dataset.mode));
  });
}

// ── Mode ─────────────────────────────────────────────────────
function setMode(mode) {
  currentMode = mode;
  const m = MODES[mode];

  document.querySelectorAll('.mode-btn').forEach(btn => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('active', active);
    btn.style.setProperty('--mode-color', m.color);
    if (active) btn.style.borderColor = m.color;
    else        btn.style.borderColor = '';
  });

  document.getElementById('qtyRow').style.display    = m.needsQty    ? 'flex' : 'none';
  document.getElementById('personRow').style.display = m.needsPerson ? 'flex' : 'none';

  document.getElementById('modeIndicator').textContent = m.label;
  document.getElementById('modeIndicator').style.background = m.color;

  refocusBarcodeInput();
}

// ── Scan submission ───────────────────────────────────────────
function onBarcodeKeydown(e) {
  if (e.key !== 'Enter') return;
  e.preventDefault();
  const barcode = e.target.value.trim();
  if (!barcode) return;
  submitScan(barcode);
}

async function submitScan(barcode) {
  const now = Date.now();
  if (now - lastScanTime < CONFIG.SCAN_COOLDOWN_MS) return;
  lastScanTime = now;

  const qty       = parseInt(document.getElementById('qtyInput')?.value || '1', 10) || 1;
  const person    = (document.getElementById('personInput')?.value || '').trim();
  const barcodeEl = document.getElementById('barcodeInput');

  barcodeEl.value = '';
  barcodeEl.disabled = true;

  let result;
  if (currentMode === 'lookup') {
    result = await api.lookup(barcode);
  } else {
    result = await api.scan(barcode, currentMode, qty, person, '');
  }

  barcodeEl.disabled = false;

  if (result.ok) {
    beepSuccess();
    showToast(buildSuccessMessage(result.data, currentMode), 'success');
    addToHistory(barcode, currentMode, result.data, true);
    if (currentMode === 'checkout') {
      document.getElementById('personInput').value = '';
    }
  } else {
    beepError();
    showToast(result.error || 'Scan failed', 'error');
    addToHistory(barcode, currentMode, null, false, result.error);
  }

  refocusBarcodeInput();
}

function buildSuccessMessage(item, mode) {
  switch (mode) {
    case 'in':       return `+${item.quantity} · ${item.name} (now ${item.quantity} in stock)`;
    case 'out':      return `−1 · ${item.name} (now ${item.quantity} in stock)`;
    case 'checkout': return `${item.name} → checked out to ${item.assigned_to}`;
    case 'checkin':  return `${item.name} → returned, back in stock`;
    case 'lookup':   return `${item.name} · ${item.item_type} · qty ${item.quantity}${item.assigned_to ? ' · out to ' + item.assigned_to : ''}`;
    default:         return item.name;
  }
}

// ── Scan history ──────────────────────────────────────────────
function addToHistory(barcode, mode, item, ok, errorMsg) {
  const entry = {
    time: new Date().toLocaleTimeString(),
    barcode,
    mode: MODES[mode].label,
    modeColor: MODES[mode].color,
    name: item?.name || barcode,
    ok,
    detail: ok ? buildSuccessMessage(item, mode) : (errorMsg || 'Error'),
  };
  scanHistory.unshift(entry);
  if (scanHistory.length > 10) scanHistory.pop();
  renderHistory();
}

function renderHistory() {
  const list = document.getElementById('historyList');
  if (scanHistory.length === 0) {
    list.innerHTML = '<li class="history-empty">No scans yet this session</li>';
    return;
  }
  list.innerHTML = scanHistory.map(e => `
    <li class="history-item ${e.ok ? 'ok' : 'err'}">
      <span class="history-badge" style="background:${e.modeColor}">${e.mode}</span>
      <span class="history-name">${e.name}</span>
      <span class="history-detail">${e.detail}</span>
      <span class="history-time">${e.time}</span>
    </li>
  `).join('');
}

// ── Toast ─────────────────────────────────────────────────────
let toastTimer;
function showToast(msg, type = 'success') {
  const t = document.getElementById('toast');
  t.textContent = msg;
  t.className = 'toast show ' + type;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), 3500);
}

// ── Camera ───────────────────────────────────────────────────
function onCameraToggle(e) {
  if (e.target.checked) startCamera();
  else stopCamera();
}

function startCamera() {
  if (cameraActive) return;
  cameraActive = true;
  document.getElementById('cameraArea').style.display = 'block';

  // Include all common 1D barcode formats — default is QR-only
  const formats = [
    Html5QrcodeSupportedFormats.QR_CODE,
    Html5QrcodeSupportedFormats.CODE_128,
    Html5QrcodeSupportedFormats.CODE_39,
    Html5QrcodeSupportedFormats.CODE_93,
    Html5QrcodeSupportedFormats.EAN_13,
    Html5QrcodeSupportedFormats.EAN_8,
    Html5QrcodeSupportedFormats.UPC_A,
    Html5QrcodeSupportedFormats.UPC_E,
    Html5QrcodeSupportedFormats.ITF,
    Html5QrcodeSupportedFormats.CODABAR,
  ];

  html5QrScanner = new Html5Qrcode('cameraArea', { formatsToSupport: formats });
  Html5Qrcode.getCameras().then(cameras => {
    if (!cameras.length) { showToast('No cameras found', 'error'); stopCamera(); return; }
    const cam = cameras[cameras.length - 1]; // prefer rear camera
    html5QrScanner.start(
      cam.id,
      { fps: 10, qrbox: { width: 300, height: 80 } }, // wide + short for 1D barcodes
      decoded => {
        // Pause the decoder IMMEDIATELY so the same barcode can't fire again
        // while the API call is in flight or during the cooldown window
        try { html5QrScanner.pause(true); } catch (_) {}

        submitScan(decoded).finally(() => {
          // Resume 1.5 s after the scan resolves — user has time to move to next item
          setTimeout(() => {
            try { if (html5QrScanner) html5QrScanner.resume(); } catch (_) {}
          }, 1500);
        });
      },
      () => {}
    ).catch(err => { showToast('Camera error: ' + err, 'error'); stopCamera(); });
  });
}

function stopCamera() {
  cameraActive = false;
  document.getElementById('cameraArea').style.display = 'none';
  if (html5QrScanner) {
    html5QrScanner.stop().catch(() => {});
    html5QrScanner = null;
  }
  document.getElementById('cameraToggle').checked = false;
  refocusBarcodeInput();
}

// ── Helpers ───────────────────────────────────────────────────
function refocusBarcodeInput() {
  // Don't steal focus back to the text input while camera is active —
  // that would let a physical scanner inject a second scan into the field
  if (cameraActive) return;
  const el = document.getElementById('barcodeInput');
  if (el && !el.disabled) setTimeout(() => el.focus(), 50);
}

init();
