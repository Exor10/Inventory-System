// Thin wrapper around fetch → Apps Script web app.
// Every call returns { ok, data?, error? }.

const api = (() => {
  const MAX_RETRIES = 2;

  function getToken() {
    const s = sessionStorage.getItem(CONFIG.SESSION_KEY);
    return s ? JSON.parse(s).token : null;
  }

  async function call(params, { retries = MAX_RETRIES } = {}) {
    const token = getToken();
    if (token) params = { token, ...params };

    // Apps Script doesn't handle CORS preflight (OPTIONS → 405).
    // URLSearchParams produces application/x-www-form-urlencoded, which is a
    // CORS "simple" content-type — no preflight sent by the browser.
    // Apps Script reads all fields via e.parameter automatically.
    const body = new URLSearchParams(
      Object.entries(params).map(([k, v]) => [k, v == null ? '' : String(v)])
    );

    let attempt = 0;
    while (true) {
      try {
        const res = await fetch(CONFIG.API_BASE_URL, {
          method: 'POST',
          body,
          redirect: 'follow',
        });

        if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };

        const json = await res.json();
        return json;

      } catch (err) {
        if (attempt < retries) {
          attempt++;
          await new Promise(r => setTimeout(r, 500 * attempt));
          continue;
        }
        return { ok: false, error: err.message || 'Network error' };
      }
    }
  }

  return {
    login(username, pin)             { return call({ action: 'login', username, pin }); },
    validateToken()                  { return call({ action: 'validate_token' }); },
    lookup(barcode, note)            { return call({ action: 'lookup', barcode, note }); },
    scan(barcode, mode, qty, assignedTo, note) {
      return call({ action: 'scan', barcode, mode, quantity: qty, assigned_to: assignedTo, note });
    },
    listItems()                      { return call({ action: 'list_items' }); },
    createItem(item)                 { return call({ action: 'create_item', ...item }); },
    updateItem(item)                 { return call({ action: 'update_item', ...item }); },
    deleteItem(barcode)              { return call({ action: 'delete_item', barcode }); },
    listMovements(dateFrom, dateTo)  { return call({ action: 'list_movements', date_from: dateFrom, date_to: dateTo }); },
    listLocations()                  { return call({ action: 'list_locations' }); },
    createLocation(name)             { return call({ action: 'create_location', name }); },
    updateLocation(name, newName)    { return call({ action: 'update_location', name, new_name: newName }); },
  };
})();
