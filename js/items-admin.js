// items-admin.js — searchable item table, add/edit/delete, barcode label printing

(async () => {
  const user = await auth.requireAdmin();
  if (!user) return;

  document.getElementById('userLabel').textContent = user.username;
  document.getElementById('adminLinks').style.display = 'flex';
  document.getElementById('logoutBtn').addEventListener('click', () => auth.logout());

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  let allItems = [];
  let locations = [];

  // ── Load data ─────────────────────────────────────────────────

  async function loadItems() {
    setLoading(true);
    const res = await api.listItems();
    setLoading(false);
    if (!res.ok) { showToast(res.error || 'Failed to load items', 'error'); return; }
    allItems = res.data;
    renderTable(filterItems());
    updateCount();
  }

  async function loadLocations() {
    const res = await api.listLocations();
    locations = res.ok ? res.data.map(l => l.name) : CONFIG.FALLBACK_LOCATIONS;
    rebuildLocationSelect();
  }

  function rebuildLocationSelect() {
    ['itemLocation', 'editLocation'].forEach(id => {
      const sel = document.getElementById(id);
      if (!sel) return;
      const cur = sel.value;
      sel.innerHTML = '<option value="">— No location —</option>' +
        locations.map(l => `<option value="${esc(l)}"${l === cur ? ' selected' : ''}>${esc(l)}</option>`).join('');
    });
  }

  // ── Filtering ─────────────────────────────────────────────────

  function filterItems() {
    const q = document.getElementById('searchInput').value.trim().toLowerCase();
    if (!q) return allItems;
    return allItems.filter(i =>
      i.name.toLowerCase().includes(q) ||
      String(i.barcode).toLowerCase().includes(q) ||
      (i.location || '').toLowerCase().includes(q) ||
      (i.item_type || '').toLowerCase().includes(q)
    );
  }

  function updateCount() {
    const visible = filterItems().length;
    document.getElementById('itemCount').textContent = `${visible} of ${allItems.length} items`;
  }

  document.getElementById('searchInput').addEventListener('input', () => {
    renderTable(filterItems());
    updateCount();
  });

  // ── Table rendering ───────────────────────────────────────────

  const TYPE_COLOR = { stock: '#38bdf8', asset: '#a78bfa', hybrid: '#fb923c' };

  function renderTable(items) {
    const tbody = document.getElementById('itemsBody');

    if (!items.length) {
      tbody.innerHTML = '<tr><td colspan="7" class="empty-cell">No items found</td></tr>';
      return;
    }

    tbody.innerHTML = items.map(i => {
      const color = TYPE_COLOR[i.item_type] || '#64748b';
      const qty   = i.item_type === 'asset'
        ? (i.assigned_to ? `<span class="badge-out">out</span>` : `<span class="badge-in">in</span>`)
        : `<span class="${i.quantity > 0 ? 'qty-ok' : 'qty-zero'}">${i.quantity}</span>`;

      return `
        <tr data-barcode="${esc(i.barcode)}">
          <td class="col-name">${esc(i.name)}</td>
          <td class="mono">${esc(i.barcode)}</td>
          <td><span class="type-badge" style="color:${color}">${esc(i.item_type)}</span></td>
          <td>${qty}</td>
          <td>${esc(i.location || '—')}</td>
          <td>${esc(i.assigned_to || '—')}</td>
          <td class="actions-cell">
            <button class="btn-icon btn-edit" data-barcode="${esc(i.barcode)}" title="Edit">&#9998;</button>
            <button class="btn-icon btn-delete" data-barcode="${esc(i.barcode)}" title="Delete">&#10005;</button>
          </td>
        </tr>
      `;
    }).join('');

    // Attach row-level handlers
    tbody.querySelectorAll('.btn-edit').forEach(btn =>
      btn.addEventListener('click', () => openEditModal(btn.dataset.barcode))
    );
    tbody.querySelectorAll('.btn-delete').forEach(btn =>
      btn.addEventListener('click', () => confirmDelete(btn.dataset.barcode))
    );
  }

  // ── Loading / toast ───────────────────────────────────────────

  function setLoading(on) {
    document.getElementById('loadingBanner').style.display = on ? '' : 'none';
  }

  let toastTimer = null;
  function showToast(msg, type = 'success') {
    const t = document.getElementById('toast');
    t.textContent = msg;
    t.className = `toast show ${type}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.className = 'toast'; }, 2800);
  }

  // ── Add modal ─────────────────────────────────────────────────

  document.getElementById('addItemBtn').addEventListener('click', () => {
    document.getElementById('addForm').reset();
    rebuildLocationSelect();
    openModal('addModal');
  });
  document.getElementById('closeAddModal').addEventListener('click', () => closeModal('addModal'));
  document.getElementById('cancelAdd').addEventListener('click', () => closeModal('addModal'));

  document.getElementById('addForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('addSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const item = {
      barcode:   document.getElementById('itemBarcode').value.trim(),
      name:      document.getElementById('itemName').value.trim(),
      item_type: document.getElementById('itemType').value,
      quantity:  parseInt(document.getElementById('itemQty').value || '0', 10),
      location:  document.getElementById('itemLocation').value,
    };

    const res = await api.createItem(item);
    btn.disabled = false;
    btn.textContent = 'Add Item';

    if (!res.ok) { showToast(res.error || 'Failed to create item', 'error'); return; }
    closeModal('addModal');
    showToast(`"${item.name}" added`);
    await loadItems();
  });

  // ── Edit modal ────────────────────────────────────────────────

  document.getElementById('closeEditModal').addEventListener('click', () => closeModal('editModal'));
  document.getElementById('cancelEdit').addEventListener('click', () => closeModal('editModal'));

  function openEditModal(barcode) {
    const item = allItems.find(i => String(i.barcode) === String(barcode));
    if (!item) return;

    document.getElementById('editBarcode').value         = item.barcode;
    document.getElementById('editBarcodeDisplay').value  = item.barcode;
    document.getElementById('editName').value            = item.name;
    document.getElementById('editType').value     = item.item_type;
    document.getElementById('editQty').value      = item.quantity;
    rebuildLocationSelect();
    const locSel = document.getElementById('editLocation');
    locSel.value = item.location || '';
    openModal('editModal');
  }

  document.getElementById('editForm').addEventListener('submit', async e => {
    e.preventDefault();
    const btn = document.getElementById('editSubmitBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const item = {
      barcode:   document.getElementById('editBarcode').value,
      name:      document.getElementById('editName').value.trim(),
      item_type: document.getElementById('editType').value,
      quantity:  parseInt(document.getElementById('editQty').value || '0', 10),
      location:  document.getElementById('editLocation').value,
    };

    const res = await api.updateItem(item);
    btn.disabled = false;
    btn.textContent = 'Save Changes';

    if (!res.ok) { showToast(res.error || 'Failed to update item', 'error'); return; }
    closeModal('editModal');
    showToast(`"${item.name}" updated`);
    await loadItems();
  });

  // ── Delete ────────────────────────────────────────────────────

  async function confirmDelete(barcode) {
    const item = allItems.find(i => String(i.barcode) === String(barcode));
    if (!item) return;
    if (!confirm(`Delete "${item.name}"?\n\nThis is a soft-delete — the item will be hidden but data is preserved.`)) return;

    const res = await api.deleteItem(barcode);
    if (!res.ok) { showToast(res.error || 'Failed to delete item', 'error'); return; }
    showToast(`"${item.name}" deleted`);
    await loadItems();
  }

  // ── Barcode label printing ────────────────────────────────────

  document.getElementById('printLabelsBtn').addEventListener('click', printLabels);

  function printLabels() {
    const items = filterItems();
    if (!items.length) { showToast('No items to print', 'error'); return; }

    const frame = document.getElementById('printFrame');
    const doc   = frame.contentDocument || frame.contentWindow.document;

    doc.open();
    doc.write(`
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="UTF-8">
        <style>
          body { margin: 0; padding: 8mm; font-family: system-ui, sans-serif; background: #fff; }
          .grid { display: flex; flex-wrap: wrap; gap: 6mm; }
          .label {
            border: 1px solid #ccc;
            border-radius: 4px;
            padding: 4mm 5mm;
            width: 90mm;
            text-align: center;
            page-break-inside: avoid;
          }
          .label-name {
            font-size: 8pt;
            font-weight: 700;
            margin-bottom: 2mm;
            word-break: break-word;
          }
          .label-barcode { display: block; max-width: 100%; }
          .label-code { font-size: 7pt; color: #666; margin-top: 1mm; }
        </style>
        <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.6/dist/JsBarcode.all.min.js"><\/script>
      </head>
      <body>
        <div class="grid">
          ${items.map(i => `
            <div class="label">
              <div class="label-name">${i.name.replace(/</g, '&lt;')}</div>
              <svg class="label-barcode" id="bc-${i.barcode.replace(/[^a-zA-Z0-9]/g, '_')}"></svg>
              <div class="label-code">${String(i.barcode).replace(/</g, '&lt;')}</div>
            </div>
          `).join('')}
        </div>
        <script>
          window.onload = function() {
            ${items.map(i => {
              const safeId = 'bc-' + String(i.barcode).replace(/[^a-zA-Z0-9]/g, '_');
              const safeBarcode = String(i.barcode).replace(/'/g, "\\'");
              return `try { JsBarcode('#${safeId}', '${safeBarcode}', { width:1.2, height:40, displayValue:false, margin:0 }); } catch(e) {}`;
            }).join('\n')}
            setTimeout(() => window.print(), 400);
          };
        <\/script>
      </body>
      </html>
    `);
    doc.close();
  }

  // ── Import from label images ──────────────────────────────────

  const importQueue = []; // { id, objectUrl, barcode, status: 'scanning'|'ok'|'fail' }

  // ZXing reader — reused across all decodes (stateless for image decoding)
  const zxingReader = new ZXing.BrowserMultiFormatReader();

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload  = () => resolve(img);
      img.onerror = reject;
      img.src     = url;
    });
  }

  async function decodeBarcode(objectUrl) {
    // Attempt 1: decode straight from the object URL
    try {
      const result = await zxingReader.decodeFromImageUrl(objectUrl);
      return result.getText();
    } catch (_) {}

    // Attempt 2: grayscale + contrast boost via canvas — helps with dark
    // backgrounds and low-contrast label photos
    try {
      const img    = await loadImage(objectUrl);
      const canvas = document.createElement('canvas');
      canvas.width  = img.naturalWidth;
      canvas.height = img.naturalHeight;
      const ctx  = canvas.getContext('2d');
      ctx.drawImage(img, 0, 0);

      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const d = imageData.data;
      for (let i = 0; i < d.length; i += 4) {
        const gray = 0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2];
        const boosted = Math.min(255, Math.max(0, 2.2 * (gray - 128) + 128));
        d[i] = d[i + 1] = d[i + 2] = boosted;
      }
      ctx.putImageData(imageData, 0, 0);

      const result = await zxingReader.decodeFromImageUrl(canvas.toDataURL());
      return result.getText();
    } catch (_) {}

    return null; // both attempts failed — user types manually
  }

  // ── OCR (Tesseract.js) ────────────────────────────────────────

  let _tesseractWorker = null;

  async function getTesseractWorker() {
    if (!_tesseractWorker) {
      _tesseractWorker = await Tesseract.createWorker('eng');
    }
    return _tesseractWorker;
  }

  function extractProductName(rawText) {
    const lines = rawText
      .split('\n')
      .map(l => l.trim())
      .filter(l => {
        if (l.length < 4) return false;
        if (/^[\d\s.\-\/]+$/.test(l)) return false;               // all numbers / barcode digits
        if (/www\.|\.com|\.net|\.org|\.io/i.test(l)) return false; // URLs
        if (/^[A-Z]{0,4}\d{3,}[A-Z0-9]*$/.test(l)) return false;  // SKU codes e.g. HHT0241
        if (/[™®©]/.test(l)) return false;                         // trademark / logo lines
        return true;
      });

    if (!lines.length) return '';
    // Longest remaining line is almost always the product description
    return lines.sort((a, b) => b.length - a.length)[0];
  }

  async function recognizeText(objectUrl) {
    try {
      const worker        = await getTesseractWorker();
      const { data: { text } } = await worker.recognize(objectUrl);
      return extractProductName(text);
    } catch (_) {
      return '';
    }
  }

  document.getElementById('importBtn').addEventListener('click', () => {
    // revoke any leftover object URLs
    importQueue.forEach(e => URL.revokeObjectURL(e.objectUrl));
    importQueue.length = 0;
    renderImportList();
    updateImportCount();
    openModal('importModal');
    // Pre-warm the Tesseract worker in the background so it's ready when images land
    getTesseractWorker().catch(() => {});
  });
  document.getElementById('closeImportModal').addEventListener('click', () => closeModal('importModal'));
  document.getElementById('cancelImport').addEventListener('click',      () => closeModal('importModal'));

  const dropZone  = document.getElementById('importDropZone');
  const fileInput = document.getElementById('importFileInput');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', e => {
    if (!dropZone.contains(e.relatedTarget)) dropZone.classList.remove('drag-over');
  });
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    addImportFiles([...e.dataTransfer.files].filter(f => f.type.startsWith('image/')));
  });
  fileInput.addEventListener('change', () => {
    addImportFiles([...fileInput.files]);
    fileInput.value = '';
  });

  async function addImportFiles(files) {
    for (const file of files) {
      const id        = Math.random().toString(36).slice(2);
      const objectUrl = URL.createObjectURL(file);
      const entry     = { id, objectUrl, barcode: '', status: 'scanning' };
      importQueue.push(entry);
      renderImportList();
      updateImportCount();

      // Run barcode decode and OCR in parallel
      const [barcodeResult, ocrResult] = await Promise.allSettled([
        decodeBarcode(objectUrl),
        recognizeText(objectUrl),
      ]);

      entry.barcode = barcodeResult.value || '';
      entry.status  = barcodeResult.value ? 'ok' : 'fail';

      // Update barcode field in-place (avoids re-render clobbering typed values)
      const barcodeEl = document.getElementById(`ib-${id}`);
      const badgeEl   = document.getElementById(`ibadge-${id}`);
      if (barcodeEl) {
        barcodeEl.value       = entry.barcode;
        barcodeEl.disabled    = false;
        barcodeEl.className   = `import-field ${entry.status}`;
        barcodeEl.placeholder = entry.status === 'ok'
          ? '✓ Decoded'
          : '⚠ Scan failed — type barcode manually';
      }
      if (badgeEl) {
        badgeEl.textContent = entry.status === 'ok' ? '✓' : '⚠';
        badgeEl.className   = `import-status-badge ${entry.status}`;
      }

      // Pre-fill name field with OCR result if user hasn't typed anything yet
      const nameEl  = document.getElementById(`in-${id}`);
      const ocrName = ocrResult.value || '';
      if (nameEl && !nameEl.value && ocrName) {
        nameEl.value       = ocrName;
        nameEl.title       = 'Pre-filled by OCR — verify before importing';
        nameEl.style.borderColor = '#f59e0b'; // amber = needs review
      }

      updateImportCount();
    }
  }

  function renderImportList() {
    const container = document.getElementById('importList');
    if (!importQueue.length) {
      container.innerHTML = '<div class="import-empty">Upload barcode images to get started</div>';
      return;
    }

    container.innerHTML = importQueue.map(entry => `
      <div class="import-row" id="row-${entry.id}">
        <div class="import-row-top">
          <img class="import-thumb" src="${entry.objectUrl}" alt="">
          <span class="import-status-badge ${entry.status}" id="ibadge-${entry.id}">
            ${entry.status === 'scanning' ? '↻' : entry.status === 'ok' ? '✓' : '⚠'}
          </span>
          <input
            id="ib-${entry.id}"
            class="import-field ${entry.status}"
            placeholder="${entry.status === 'scanning' ? 'Scanning…' : entry.status === 'ok' ? '✓ Decoded' : '⚠ Scan failed — type barcode manually'}"
            value="${esc(entry.barcode)}"
            ${entry.status === 'scanning' ? 'disabled' : ''}
            style="font-family:monospace"
          >
          <button class="btn-remove" data-id="${entry.id}" title="Remove">✕</button>
        </div>
        <div class="import-row-bottom">
          <input  id="in-${entry.id}" class="import-field" placeholder="Item name *">
          <select id="it-${entry.id}" class="import-field">
            <option value="stock">Stock</option>
            <option value="asset">Asset</option>
            <option value="hybrid">Hybrid</option>
          </select>
          <input  id="iq-${entry.id}" class="import-field" type="number" min="0" value="0" title="Quantity">
          <select id="il-${entry.id}" class="import-field">
            <option value="">— Location —</option>
            ${locations.map(l => `<option value="${esc(l)}">${esc(l)}</option>`).join('')}
          </select>
        </div>
      </div>
    `).join('');

    container.querySelectorAll('.btn-remove').forEach(btn =>
      btn.addEventListener('click', () => {
        const idx = importQueue.findIndex(e => e.id === btn.dataset.id);
        if (idx === -1) return;
        URL.revokeObjectURL(importQueue[idx].objectUrl);
        importQueue.splice(idx, 1);
        renderImportList();
        updateImportCount();
      })
    );
  }

  function updateImportCount() {
    const total   = importQueue.length;
    const done    = importQueue.filter(e => e.status !== 'scanning').length;
    const countEl = document.getElementById('importCount');
    const btn     = document.getElementById('importSubmitBtn');

    if (!total) {
      countEl.textContent  = '';
      btn.disabled         = true;
      btn.textContent      = 'Import Items';
      return;
    }

    const scanning = done < total;
    countEl.textContent = scanning
      ? `Scanning… ${done} / ${total}`
      : `${total} item${total !== 1 ? 's' : ''} ready to import`;
    btn.disabled    = scanning;
    btn.textContent = scanning ? 'Scanning…' : `Import ${total} Item${total !== 1 ? 's' : ''}`;
  }

  document.getElementById('importSubmitBtn').addEventListener('click', async () => {
    const btn = document.getElementById('importSubmitBtn');
    btn.disabled    = true;
    btn.textContent = 'Importing…';

    let imported = 0;
    let failed   = 0;

    for (const entry of [...importQueue]) {
      const barcode  = (document.getElementById(`ib-${entry.id}`)?.value  || '').trim();
      const name     = (document.getElementById(`in-${entry.id}`)?.value  || '').trim();
      const itemType =  document.getElementById(`it-${entry.id}`)?.value  || 'stock';
      const qty      = parseInt(document.getElementById(`iq-${entry.id}`)?.value || '0', 10);
      const location =  document.getElementById(`il-${entry.id}`)?.value  || '';
      const row      =  document.getElementById(`row-${entry.id}`);

      if (!barcode || !name) {
        if (row) row.style.borderLeftColor = '#ef4444';
        failed++;
        continue;
      }

      const res = await api.createItem({ barcode, name, item_type: itemType, quantity: qty, location });
      if (res.ok) {
        if (row) row.style.borderLeftColor = '#22c55e';
        imported++;
      } else {
        if (row) { row.style.borderLeftColor = '#ef4444'; row.title = res.error || 'Failed'; }
        failed++;
      }
    }

    if (failed === 0) {
      // Clean up and close
      importQueue.forEach(e => URL.revokeObjectURL(e.objectUrl));
      importQueue.length = 0;
      closeModal('importModal');
      showToast(`${imported} item${imported !== 1 ? 's' : ''} imported`);
      await loadItems();
    } else {
      btn.disabled    = false;
      btn.textContent = `Retry (${failed} failed)`;
      showToast(
        imported > 0
          ? `${imported} imported, ${failed} failed — fix red rows`
          : `${failed} item${failed !== 1 ? 's' : ''} failed — barcode and name are required`,
        'error'
      );
    }
  });

  // ── Modal helpers ─────────────────────────────────────────────

  function openModal(id) {
    document.getElementById(id).style.display = 'flex';
    document.body.style.overflow = 'hidden';
  }
  function closeModal(id) {
    document.getElementById(id).style.display = 'none';
    document.body.style.overflow = '';
  }

  // Close modals on overlay click
  ['addModal', 'editModal', 'importModal'].forEach(id => {
    document.getElementById(id).addEventListener('click', e => {
      if (e.target === e.currentTarget) closeModal(id);
    });
  });

  // ── Init ──────────────────────────────────────────────────────
  await Promise.all([loadItems(), loadLocations()]);
})();
