// reports.js — date-range movements, breakdown chart, top-10 table, CSV export

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

  // ── Default date range: last 7 days ───────────────────────────

  function isoDate(d) { return d.toISOString().slice(0, 10); }

  const today    = new Date();
  const weekAgo  = new Date(today);
  weekAgo.setDate(today.getDate() - 6);

  document.getElementById('dateFrom').value = isoDate(weekAgo);
  document.getElementById('dateTo').value   = isoDate(today);

  // ── Chart instance ────────────────────────────────────────────

  let chartInstance = null;

  const ACTION_COLOR = {
    in:       'rgba(34, 197, 94, .75)',
    out:      'rgba(249, 115, 22, .75)',
    checkout: 'rgba(167, 139, 250, .75)',
    checkin:  'rgba(56, 189, 248, .75)',
    lookup:   'rgba(100, 116, 139, .75)',
  };

  // ── Load & render ─────────────────────────────────────────────

  async function loadReport() {
    const from = document.getElementById('dateFrom').value;
    const to   = document.getElementById('dateTo').value;
    if (!from || !to) return;

    setLoading(true);
    setError(null);

    const res = await api.listMovements(from, to);
    setLoading(false);

    if (!res.ok) {
      setError(res.error || 'Failed to load movements');
      return;
    }

    const movements = res.data;
    renderSummaryCards(movements);
    renderChart(movements);
    renderTopItems(movements);

    document.getElementById('exportCsvBtn').dataset.ready = '1';
    window._reportMovements = movements;
    window._reportRange     = { from, to };
  }

  // ── Summary cards ─────────────────────────────────────────────

  function renderSummaryCards(movements) {
    const total   = movements.length;
    const byType  = {};
    movements.forEach(m => { byType[m.action] = (byType[m.action] || 0) + 1; });

    document.getElementById('statTotal').textContent    = total;
    document.getElementById('statIn').textContent       = byType['in']       || 0;
    document.getElementById('statOut').textContent      = byType['out']      || 0;
    document.getElementById('statCheckout').textContent = byType['checkout'] || 0;
    document.getElementById('statCheckin').textContent  = byType['checkin']  || 0;
  }

  // ── Bar chart ─────────────────────────────────────────────────

  function renderChart(movements) {
    const buckets = {};
    movements.forEach(m => {
      const day = String(m.timestamp).slice(0, 10);
      if (!buckets[day]) buckets[day] = { in: 0, out: 0, checkout: 0, checkin: 0, lookup: 0 };
      if (buckets[day][m.action] !== undefined) buckets[day][m.action]++;
      else buckets[day].lookup++;
    });

    const labels = Object.keys(buckets).sort();
    const actions = ['in', 'out', 'checkout', 'checkin', 'lookup'];

    const datasets = actions.map(action => ({
      label:           action,
      data:            labels.map(day => buckets[day]?.[action] || 0),
      backgroundColor: ACTION_COLOR[action] || 'rgba(100,116,139,.75)',
      borderRadius:    3,
    }));

    const ctx = document.getElementById('movementsChart').getContext('2d');
    if (chartInstance) chartInstance.destroy();

    chartInstance = new Chart(ctx, {
      type: 'bar',
      data: { labels, datasets },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            labels: { color: '#94a3b8', font: { size: 11 }, boxWidth: 12 },
          },
        },
        scales: {
          x: {
            stacked: true,
            ticks:  { color: '#64748b', font: { size: 11 } },
            grid:   { color: '#1e293b' },
          },
          y: {
            stacked: true,
            ticks:  { color: '#64748b', font: { size: 11 }, stepSize: 1 },
            grid:   { color: '#1e293b' },
          },
        },
      },
    });
  }

  // ── Top 10 items ──────────────────────────────────────────────

  function renderTopItems(movements) {
    const counts = {};
    movements.forEach(m => {
      if (m.action === 'lookup') return;
      const key = m.item_name || m.barcode;
      counts[key] = (counts[key] || 0) + 1;
    });

    const sorted = Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    const tbody = document.getElementById('topItemsBody');

    if (!sorted.length) {
      tbody.innerHTML = '<tr><td colspan="3" class="empty-cell">No movements in this range</td></tr>';
      return;
    }

    const max = sorted[0][1];

    tbody.innerHTML = sorted.map(([name, count], idx) => {
      const pct = Math.round((count / max) * 100);
      return `
        <tr>
          <td class="rank-cell">${idx + 1}</td>
          <td class="name-cell">${esc(name)}</td>
          <td class="bar-cell">
            <div class="bar-wrap">
              <div class="bar-fill" style="width:${pct}%"></div>
              <span class="bar-label">${count}</span>
            </div>
          </td>
        </tr>
      `;
    }).join('');
  }

  // ── CSV export ────────────────────────────────────────────────

  document.getElementById('exportCsvBtn').addEventListener('click', () => {
    const movements = window._reportMovements;
    if (!movements?.length) return;

    const headers = ['timestamp', 'barcode', 'item_name', 'action', 'quantity_delta', 'user', 'assigned_to', 'note'];
    const rows    = movements.map(m =>
      headers.map(h => {
        const v = String(m[h] ?? '');
        return v.includes(',') || v.includes('"') || v.includes('\n')
          ? `"${v.replace(/"/g, '""')}"`
          : v;
      }).join(',')
    );

    const csv  = [headers.join(','), ...rows].join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement('a');
    const { from, to } = window._reportRange || {};
    a.href     = url;
    a.download = `movements_${from || 'all'}_to_${to || 'all'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  });

  // ── UI helpers ────────────────────────────────────────────────

  function setLoading(on) {
    document.getElementById('loadingBanner').style.display = on ? '' : 'none';
    document.getElementById('loadBtn').disabled = on;
  }

  function setError(msg) {
    const el = document.getElementById('errorBanner');
    if (msg) { el.textContent = msg; el.style.display = ''; }
    else      { el.style.display = 'none'; }
  }

  // ── Init ──────────────────────────────────────────────────────

  document.getElementById('loadBtn').addEventListener('click', loadReport);
  document.getElementById('dateFrom').addEventListener('change', loadReport);
  document.getElementById('dateTo').addEventListener('change', loadReport);

  await loadReport();
})();
