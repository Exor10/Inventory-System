// dashboard.js — stats, checked-out list, activity feed, auto-refresh

(async () => {
  const user = await auth.requireAuth();
  if (!user) return;

  document.getElementById('userLabel').textContent = user.username;
  if (user.role === 'admin') {
    document.getElementById('adminLinks').style.display = 'flex';
  }
  document.getElementById('logoutBtn').addEventListener('click', () => auth.logout());

  function esc(s) {
    return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function relTime(isoStr) {
    const d = new Date(isoStr);
    if (isNaN(d)) return '';
    const diff = Date.now() - d;
    const m = Math.floor(diff / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    return `${Math.floor(h / 24)}d ago`;
  }

  const ACTION_COLOR = {
    in:       '#22c55e',
    out:      '#f97316',
    checkout: '#a78bfa',
    checkin:  '#38bdf8',
    lookup:   '#64748b',
  };

  // ── Stats ────────────────────────────────────────────────────

  function renderStats(items) {
    const totalItems = items.length;
    const totalQty   = items.reduce((s, i) => s + (Number(i.quantity) || 0), 0);
    const checkedOut = items.filter(i => i.assigned_to).length;
    const available  = items.filter(i => !i.assigned_to).length;

    document.getElementById('statTotalItems').textContent = totalItems;
    document.getElementById('statTotalQty').textContent   = totalQty;
    document.getElementById('statCheckedOut').textContent = checkedOut;
    document.getElementById('statAvailable').textContent  = available;
  }

  // ── Checked-out items ────────────────────────────────────────

  function renderCheckedOut(items) {
    const list  = items.filter(i => i.assigned_to);
    const tbody = document.getElementById('checkedOutBody');

    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">No items currently checked out</td></tr>';
      return;
    }

    tbody.innerHTML = list.map(i => `
      <tr>
        <td>${esc(i.name)}</td>
        <td class="mono">${esc(i.barcode)}</td>
        <td>${esc(i.assigned_to)}</td>
        <td>${esc(i.location || '—')}</td>
      </tr>
    `).join('');
  }

  // ── Activity feed ────────────────────────────────────────────

  function renderActivity(movements) {
    const last20 = [...movements].reverse().slice(0, 20);
    const list   = document.getElementById('activityList');

    if (!last20.length) {
      list.innerHTML = '<li class="history-empty">No activity in the last 30 days</li>';
      return;
    }

    list.innerHTML = last20.map(m => {
      const color  = ACTION_COLOR[m.action] || '#64748b';
      const detail = [
        m.quantity_delta ? `qty ${m.quantity_delta > 0 ? '+' : ''}${m.quantity_delta}` : '',
        m.assigned_to    ? `→ ${m.assigned_to}` : '',
        m.user           ? `by ${m.user}` : '',
        relTime(m.timestamp),
      ].filter(Boolean).join(' · ');

      return `
        <li class="history-item">
          <span class="history-badge" style="background:${color}">${esc(m.action)}</span>
          <span class="history-name">${esc(m.item_name)}</span>
          <span class="history-detail">${esc(detail)}</span>
        </li>
      `;
    }).join('');
  }

  // ── Loading state ─────────────────────────────────────────────

  function setLoading(on) {
    document.getElementById('loadingBanner').style.display = on ? '' : 'none';
  }

  function setError(msg) {
    const el = document.getElementById('errorBanner');
    if (msg) {
      el.textContent = msg;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  }

  // ── Load all data ─────────────────────────────────────────────

  async function loadAll() {
    setError(null);
    setLoading(true);

    const dateFrom = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const [itemsRes, movRes] = await Promise.all([
      api.listItems(),
      api.listMovements(dateFrom, null),
    ]);

    setLoading(false);

    if (!itemsRes.ok && !movRes.ok) {
      setError('Failed to load data. Check your connection and try again.');
      return;
    }

    if (itemsRes.ok) {
      renderStats(itemsRes.data);
      renderCheckedOut(itemsRes.data);
    }
    if (movRes.ok) {
      renderActivity(movRes.data);
    }
  }

  // ── Auto-refresh countdown ────────────────────────────────────

  const refreshInterval = CONFIG.DASHBOARD_REFRESH;
  let secondsLeft = refreshInterval / 1000;
  const refreshBadge = document.getElementById('refreshBadge');

  function tick() {
    secondsLeft--;
    if (refreshBadge) refreshBadge.textContent = `${secondsLeft}s`;
    if (secondsLeft <= 0) {
      secondsLeft = refreshInterval / 1000;
      loadAll();
    }
  }

  function resetCountdown() {
    secondsLeft = refreshInterval / 1000;
    if (refreshBadge) refreshBadge.textContent = `${secondsLeft}s`;
  }

  setInterval(tick, 1000);

  document.getElementById('refreshNowBtn').addEventListener('click', () => {
    resetCountdown();
    loadAll();
  });

  // ── Init ──────────────────────────────────────────────────────
  resetCountdown();
  await loadAll();
})();
