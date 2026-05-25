// ============================================================
// INVENTORY SYSTEM — Google Apps Script Backend
// Stage 1: login, validate_token, lookup
// ============================================================

var SPREADSHEET_ID = ''; // TODO: paste your Google Sheet ID here

// ── Sheet name constants ─────────────────────────────────────
var SHEET = {
  ITEMS:     'Items',
  MOVEMENTS: 'Movements',
  USERS:     'Users',
  SESSIONS:  'Sessions',
  LOCATIONS: 'Locations'
};

// ── Column indices (1-based, matching the header rows below) ─
// Items: id | barcode | name | item_type | quantity | location | assigned_to | active | created_at | updated_at
var ITEMS_COL = { ID:1, BARCODE:2, NAME:3, TYPE:4, QTY:5, LOCATION:6, ASSIGNED_TO:7, ACTIVE:8, CREATED_AT:9, UPDATED_AT:10 };

// Movements: timestamp | barcode | item_name | action | quantity_delta | user | assigned_to | note
var MOV_COL = { TIMESTAMP:1, BARCODE:2, ITEM_NAME:3, ACTION:4, QTY_DELTA:5, USER:6, ASSIGNED_TO:7, NOTE:8 };

// Users: username | pin_hash | role | active
var USR_COL = { USERNAME:1, PIN_HASH:2, ROLE:3, ACTIVE:4 };

// Sessions: token | username | expires_at
var SES_COL = { TOKEN:1, USERNAME:2, EXPIRES_AT:3 };

// Locations: name | active
var LOC_COL = { NAME:1, ACTIVE:2 };

var SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours

// ============================================================
// ENTRY POINTS
// ============================================================

function doGet(e) {
  return route(e);
}

function doPost(e) {
  return route(e);
}

function route(e) {
  try {
    var params = mergeParams(e);
    var action = params.action || '';

    // Public actions — no token required
    if (action === 'login')          return respond(handleLogin(params));

    // Protected actions — token required
    var auth = requireAuth(params);
    if (!auth.ok) return respond(auth);

    if (action === 'validate_token') return respond(handleValidateToken(auth.user));
    if (action === 'lookup')         return respond(handleLookup(params, auth.user));
    if (action === 'scan')           return respond(handleScan(params, auth.user));
    if (action === 'list_items')     return respond(handleListItems(params, auth.user));
    if (action === 'create_item')    return respond(handleCreateItem(params, auth.user));
    if (action === 'update_item')    return respond(handleUpdateItem(params, auth.user));
    if (action === 'delete_item')    return respond(handleDeleteItem(params, auth.user));
    if (action === 'list_movements')   return respond(handleListMovements(params, auth.user));
    if (action === 'list_locations')   return respond(handleListLocations(auth.user));
    if (action === 'create_location')  return respond(handleCreateLocation(params, auth.user));
    if (action === 'update_location')  return respond(handleUpdateLocation(params, auth.user));

    return respond({ ok: false, error: 'Unknown action: ' + action }, 400);
  } catch (err) {
    return respond({ ok: false, error: err.message }, 500);
  }
}

// ============================================================
// AUTH HELPERS
// ============================================================

function mergeParams(e) {
  var p = {};
  if (e.parameter) {
    for (var k in e.parameter) p[k] = e.parameter[k];
  }
  if (e.postData && e.postData.contents) {
    try {
      var body = JSON.parse(e.postData.contents);
      for (var k in body) p[k] = body[k];
    } catch (_) {}
  }
  return p;
}

function requireAuth(params) {
  var token = params.token || '';
  if (!token) return { ok: false, error: 'Missing token', status: 401 };

  var ss = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET.SESSIONS);
  var rows = sheet.getDataRange().getValues();
  var now = new Date();

  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (row[SES_COL.TOKEN - 1] === token) {
      var expires = new Date(row[SES_COL.EXPIRES_AT - 1]);
      if (expires < now) return { ok: false, error: 'Session expired', status: 401 };

      var username = row[SES_COL.USERNAME - 1];
      var user = getUser(ss, username);
      if (!user || user.active !== true && user.active !== 'TRUE') {
        return { ok: false, error: 'User inactive', status: 403 };
      }
      return { ok: true, user: user };
    }
  }
  return { ok: false, error: 'Invalid token', status: 401 };
}

function requireAdmin(user) {
  if (user.role !== 'admin') return { ok: false, error: 'Admin role required', status: 403 };
  return { ok: true };
}

function getUser(ss, username) {
  var sheet = ss.getSheetByName(SHEET.USERS);
  var rows = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var row = rows[i];
    if (String(row[USR_COL.USERNAME - 1]).toLowerCase() === username.toLowerCase()) {
      return {
        username: row[USR_COL.USERNAME - 1],
        pin_hash: row[USR_COL.PIN_HASH - 1],
        role:     row[USR_COL.ROLE - 1],
        active:   row[USR_COL.ACTIVE - 1]
      };
    }
  }
  return null;
}

// ============================================================
// SHA-256 helper (Apps Script has no built-in, use Utilities)
// ============================================================

function sha256(str) {
  var bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, str, Utilities.Charset.UTF_8);
  return bytes.map(function(b) {
    var hex = (b < 0 ? b + 256 : b).toString(16);
    return hex.length === 1 ? '0' + hex : hex;
  }).join('');
}

// ============================================================
// HANDLERS
// ============================================================

// ── login ────────────────────────────────────────────────────
function handleLogin(params) {
  var username = (params.username || '').trim();
  var pin      = (params.pin || '').trim();
  if (!username || !pin) return { ok: false, error: 'username and pin required' };

  var ss   = getSpreadsheet();
  var user = getUser(ss, username);
  if (!user) return { ok: false, error: 'Invalid credentials' };
  if (user.active !== true && String(user.active).toUpperCase() !== 'TRUE') {
    return { ok: false, error: 'Account disabled' };
  }

  var hash = sha256(pin);
  if (hash !== user.pin_hash) return { ok: false, error: 'Invalid credentials' };

  // Clean up expired sessions for this user
  cleanExpiredSessions(ss);

  // Create session token
  var token   = Utilities.getUuid();
  var expires = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  var sesSheet = ss.getSheetByName(SHEET.SESSIONS);
  sesSheet.appendRow([token, user.username, expires]);

  return { ok: true, data: { token: token, username: user.username, role: user.role, expires_at: expires } };
}

// ── validate_token ───────────────────────────────────────────
function handleValidateToken(user) {
  return { ok: true, data: { username: user.username, role: user.role } };
}

// ── lookup ───────────────────────────────────────────────────
function handleLookup(params, user) {
  var barcode = (params.barcode || '').trim();
  if (!barcode) return { ok: false, error: 'barcode required' };

  var ss   = getSpreadsheet();
  var item = findItemByBarcode(ss, barcode);
  if (!item) return { ok: false, error: 'Item not found' };

  appendMovement(ss, barcode, item.name, 'lookup', 0, user.username, '', params.note || '');

  return { ok: true, data: item };
}

// ── scan ─────────────────────────────────────────────────────
function handleScan(params, user) {
  var barcode   = (params.barcode || '').trim();
  var mode      = (params.mode || '').trim();       // in | out | checkout | checkin
  var qty       = parseInt(params.quantity || '1', 10);
  var assignTo  = (params.assigned_to || '').trim();
  var note      = (params.note || '').trim();

  if (!barcode) return { ok: false, error: 'barcode required' };
  if (!mode)    return { ok: false, error: 'mode required' };
  if (isNaN(qty) || qty < 1) qty = 1;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(10000);
  } catch (_) {
    return { ok: false, error: 'Server busy, try again' };
  }

  try {
    var ss   = getSpreadsheet();
    var item = findItemByBarcode(ss, barcode);
    if (!item) return { ok: false, error: 'Item not found' };

    var sheet  = ss.getSheetByName(SHEET.ITEMS);
    var rowIdx = item._row;
    var now    = new Date().toISOString();
    var delta  = 0;

    if (mode === 'in') {
      if (item.item_type === 'asset') return { ok: false, error: 'Use checkin for assets' };
      var newQty = item.quantity + qty;
      sheet.getRange(rowIdx, ITEMS_COL.QTY).setValue(newQty);
      sheet.getRange(rowIdx, ITEMS_COL.UPDATED_AT).setValue(now);
      delta = qty;
      item.quantity = newQty;

    } else if (mode === 'out') {
      if (item.item_type === 'asset') return { ok: false, error: 'Use checkout for assets' };
      if (item.quantity < qty) return { ok: false, error: 'Insufficient quantity (' + item.quantity + ' available)' };
      var newQty = item.quantity - qty;
      sheet.getRange(rowIdx, ITEMS_COL.QTY).setValue(newQty);
      sheet.getRange(rowIdx, ITEMS_COL.UPDATED_AT).setValue(now);
      delta = -qty;
      item.quantity = newQty;

    } else if (mode === 'checkout') {
      if (item.item_type === 'stock') return { ok: false, error: 'Use stock-out for stock items' };
      if (!assignTo) return { ok: false, error: 'assigned_to required for checkout' };
      if (item.assigned_to) return { ok: false, error: 'Item already checked out to ' + item.assigned_to };
      sheet.getRange(rowIdx, ITEMS_COL.QTY).setValue(0);
      sheet.getRange(rowIdx, ITEMS_COL.ASSIGNED_TO).setValue(assignTo);
      sheet.getRange(rowIdx, ITEMS_COL.UPDATED_AT).setValue(now);
      delta = -1;
      item.assigned_to = assignTo;
      item.quantity = 0;

    } else if (mode === 'checkin') {
      if (item.item_type === 'stock') return { ok: false, error: 'Use stock-in for stock items' };
      if (!item.assigned_to) return { ok: false, error: 'Item is not currently checked out' };
      sheet.getRange(rowIdx, ITEMS_COL.QTY).setValue(1);
      sheet.getRange(rowIdx, ITEMS_COL.ASSIGNED_TO).setValue('');
      sheet.getRange(rowIdx, ITEMS_COL.UPDATED_AT).setValue(now);
      delta = 1;
      assignTo = item.assigned_to; // log who returned it
      item.assigned_to = '';
      item.quantity = 1;

    } else {
      return { ok: false, error: 'Unknown mode: ' + mode };
    }

    appendMovement(ss, barcode, item.name, mode, delta, user.username, assignTo, note);
    return { ok: true, data: item };

  } finally {
    lock.releaseLock();
  }
}

// ── list_items ───────────────────────────────────────────────
function handleListItems(params, user) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET.ITEMS);
  var rows  = sheet.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[ITEMS_COL.ACTIVE - 1]).toUpperCase() !== 'TRUE') continue;
    items.push(rowToItem(r, i + 1));
  }
  return { ok: true, data: items };
}

// ── create_item ──────────────────────────────────────────────
function handleCreateItem(params, user) {
  var chk = requireAdmin(user);
  if (!chk.ok) return chk;

  var barcode  = (params.barcode || '').trim();
  var name     = (params.name || '').trim();
  var type     = (params.item_type || 'stock').trim();
  var qty      = parseInt(params.quantity || '0', 10);
  var location = (params.location || '').trim();

  if (!barcode) return { ok: false, error: 'barcode required' };
  if (!name)    return { ok: false, error: 'name required' };
  if (!['stock','asset','hybrid'].includes(type)) return { ok: false, error: 'item_type must be stock|asset|hybrid' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(_) { return { ok: false, error: 'Server busy' }; }

  try {
    var ss = getSpreadsheet();
    var existing = findItemByBarcode(ss, barcode);
    if (existing) return { ok: false, error: 'Barcode already exists' };

    var now  = new Date().toISOString();
    var id   = Utilities.getUuid();
    var sheet = ss.getSheetByName(SHEET.ITEMS);
    sheet.appendRow([id, barcode, name, type, qty, location, '', true, now, now]);
    return { ok: true, data: { id: id, barcode: barcode, name: name, item_type: type, quantity: qty, location: location } };
  } finally {
    lock.releaseLock();
  }
}

// ── update_item ──────────────────────────────────────────────
function handleUpdateItem(params, user) {
  var chk = requireAdmin(user);
  if (!chk.ok) return chk;

  var barcode = (params.barcode || '').trim();
  if (!barcode) return { ok: false, error: 'barcode required' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(_) { return { ok: false, error: 'Server busy' }; }

  try {
    var ss   = getSpreadsheet();
    var item = findItemByBarcode(ss, barcode);
    if (!item) return { ok: false, error: 'Item not found' };

    var sheet = ss.getSheetByName(SHEET.ITEMS);
    var row   = item._row;
    var now   = new Date().toISOString();

    if (params.name     !== undefined) sheet.getRange(row, ITEMS_COL.NAME).setValue(params.name);
    if (params.item_type!== undefined) sheet.getRange(row, ITEMS_COL.TYPE).setValue(params.item_type);
    if (params.quantity !== undefined) sheet.getRange(row, ITEMS_COL.QTY).setValue(parseInt(params.quantity, 10));
    if (params.location !== undefined) sheet.getRange(row, ITEMS_COL.LOCATION).setValue(params.location);
    sheet.getRange(row, ITEMS_COL.UPDATED_AT).setValue(now);

    return { ok: true, data: findItemByBarcode(ss, barcode) };
  } finally {
    lock.releaseLock();
  }
}

// ── delete_item (soft) ───────────────────────────────────────
function handleDeleteItem(params, user) {
  var chk = requireAdmin(user);
  if (!chk.ok) return chk;

  var barcode = (params.barcode || '').trim();
  if (!barcode) return { ok: false, error: 'barcode required' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(_) { return { ok: false, error: 'Server busy' }; }

  try {
    var ss   = getSpreadsheet();
    var item = findItemByBarcode(ss, barcode);
    if (!item) return { ok: false, error: 'Item not found' };

    var sheet = ss.getSheetByName(SHEET.ITEMS);
    sheet.getRange(item._row, ITEMS_COL.ACTIVE).setValue(false);
    sheet.getRange(item._row, ITEMS_COL.UPDATED_AT).setValue(new Date().toISOString());
    return { ok: true, data: { barcode: barcode, active: false } };
  } finally {
    lock.releaseLock();
  }
}

// ── list_movements ───────────────────────────────────────────
function handleListMovements(params, user) {
  var from = params.date_from ? new Date(params.date_from) : new Date(Date.now() - 7*24*60*60*1000);
  var to   = params.date_to   ? new Date(params.date_to)   : new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);

  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET.MOVEMENTS);
  var rows  = sheet.getDataRange().getValues();
  var out   = [];
  for (var i = 1; i < rows.length; i++) {
    var r  = rows[i];
    var ts = new Date(r[MOV_COL.TIMESTAMP - 1]);
    if (ts < from || ts > to) continue;
    out.push({
      timestamp:     r[MOV_COL.TIMESTAMP  - 1],
      barcode:       r[MOV_COL.BARCODE    - 1],
      item_name:     r[MOV_COL.ITEM_NAME  - 1],
      action:        r[MOV_COL.ACTION     - 1],
      quantity_delta:r[MOV_COL.QTY_DELTA  - 1],
      user:          r[MOV_COL.USER       - 1],
      assigned_to:   r[MOV_COL.ASSIGNED_TO- 1],
      note:          r[MOV_COL.NOTE       - 1]
    });
  }
  return { ok: true, data: out };
}

// ── list_locations ───────────────────────────────────────────
function handleListLocations(user) {
  var ss    = getSpreadsheet();
  var sheet = ss.getSheetByName(SHEET.LOCATIONS);
  var rows  = sheet.getDataRange().getValues();
  var out   = [];
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[LOC_COL.ACTIVE - 1]).toUpperCase() !== 'TRUE') continue;
    out.push({ name: r[LOC_COL.NAME - 1] });
  }
  return { ok: true, data: out };
}

// ── create_location ──────────────────────────────────────────
function handleCreateLocation(params, user) {
  var chk = requireAdmin(user);
  if (!chk.ok) return chk;

  var name = (params.name || '').trim();
  if (!name) return { ok: false, error: 'name required' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(_) { return { ok: false, error: 'Server busy' }; }

  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET.LOCATIONS);
    var rows  = sheet.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][LOC_COL.NAME - 1]).toLowerCase() === name.toLowerCase()) {
        return { ok: false, error: 'Location already exists' };
      }
    }

    sheet.appendRow([name, true]);
    return { ok: true, data: { name: name } };
  } finally {
    lock.releaseLock();
  }
}

// ── update_location ──────────────────────────────────────────
function handleUpdateLocation(params, user) {
  var chk = requireAdmin(user);
  if (!chk.ok) return chk;

  var name    = (params.name || '').trim();
  var newName = (params.new_name || '').trim();
  if (!name)    return { ok: false, error: 'name required' };
  if (!newName) return { ok: false, error: 'new_name required' };

  var lock = LockService.getScriptLock();
  try { lock.waitLock(10000); } catch(_) { return { ok: false, error: 'Server busy' }; }

  try {
    var ss    = getSpreadsheet();
    var sheet = ss.getSheetByName(SHEET.LOCATIONS);
    var rows  = sheet.getDataRange().getValues();

    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][LOC_COL.NAME - 1]).toLowerCase() === name.toLowerCase()) {
        sheet.getRange(i + 1, LOC_COL.NAME).setValue(newName);
        return { ok: true, data: { name: newName } };
      }
    }
    return { ok: false, error: 'Location not found' };
  } finally {
    lock.releaseLock();
  }
}

// ============================================================
// UTILITIES
// ============================================================

function getSpreadsheet() {
  if (SPREADSHEET_ID) return SpreadsheetApp.openById(SPREADSHEET_ID);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function findItemByBarcode(ss, barcode) {
  var sheet = ss.getSheetByName(SHEET.ITEMS);
  var rows  = sheet.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    var r = rows[i];
    if (String(r[ITEMS_COL.BARCODE - 1]) === String(barcode) &&
        String(r[ITEMS_COL.ACTIVE - 1]).toUpperCase() === 'TRUE') {
      return rowToItem(r, i + 1);
    }
  }
  return null;
}

function rowToItem(r, rowIdx) {
  return {
    _row:        rowIdx,
    id:          r[ITEMS_COL.ID          - 1],
    barcode:     r[ITEMS_COL.BARCODE     - 1],
    name:        r[ITEMS_COL.NAME        - 1],
    item_type:   r[ITEMS_COL.TYPE        - 1],
    quantity:    Number(r[ITEMS_COL.QTY  - 1]),
    location:    r[ITEMS_COL.LOCATION    - 1],
    assigned_to: r[ITEMS_COL.ASSIGNED_TO - 1],
    active:      r[ITEMS_COL.ACTIVE      - 1],
    created_at:  r[ITEMS_COL.CREATED_AT  - 1],
    updated_at:  r[ITEMS_COL.UPDATED_AT  - 1]
  };
}

function appendMovement(ss, barcode, itemName, action, delta, user, assignedTo, note) {
  var sheet = ss.getSheetByName(SHEET.MOVEMENTS);
  sheet.appendRow([
    new Date().toISOString(),
    barcode,
    itemName,
    action,
    delta,
    user,
    assignedTo || '',
    note || ''
  ]);
}

function cleanExpiredSessions(ss) {
  var sheet = ss.getSheetByName(SHEET.SESSIONS);
  var rows  = sheet.getDataRange().getValues();
  var now   = new Date();
  // Walk backwards so row deletion doesn't shift indices
  for (var i = rows.length - 1; i >= 1; i--) {
    var expires = new Date(rows[i][SES_COL.EXPIRES_AT - 1]);
    if (expires < now) sheet.deleteRow(i + 1);
  }
}

function respond(result, statusHint) {
  var payload = JSON.stringify(result);
  return ContentService
    .createTextOutput(payload)
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// ONE-TIME SETUP — run this manually once from the Apps Script
// editor to create all sheets and seed the first admin user.
// ============================================================

function setupSheets() {
  var ss = getSpreadsheet();

  function ensureSheet(name, headers) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
    return sheet;
  }

  ensureSheet(SHEET.ITEMS, [
    'id','barcode','name','item_type','quantity','location','assigned_to','active','created_at','updated_at'
  ]);
  ensureSheet(SHEET.MOVEMENTS, [
    'timestamp','barcode','item_name','action','quantity_delta','user','assigned_to','note'
  ]);
  ensureSheet(SHEET.USERS, ['username','pin_hash','role','active']);
  ensureSheet(SHEET.SESSIONS, ['token','username','expires_at']);
  ensureSheet(SHEET.LOCATIONS, ['name','active']);

  // Seed default locations
  var locSheet = ss.getSheetByName(SHEET.LOCATIONS);
  if (locSheet.getLastRow() <= 1) {
    locSheet.appendRow(['Shelf A',      true]);
    locSheet.appendRow(['Shelf B',      true]);
    locSheet.appendRow(['Storage Room', true]);
  }

  // Seed admin user — PIN is "1234" (change immediately after first login)
  var usrSheet = ss.getSheetByName(SHEET.USERS);
  if (usrSheet.getLastRow() <= 1) {
    var adminPin = sha256('1234');
    usrSheet.appendRow(['admin', adminPin, 'admin', true]);
    Logger.log('Admin user created. PIN: 1234 — change this immediately.');
  }

  Logger.log('setupSheets complete.');
}
