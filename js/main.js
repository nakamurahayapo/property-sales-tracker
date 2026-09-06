// ============================================================
//  買取再販 物件販売管理アプリ - メインロジック
// ============================================================

let properties = [];       // Firestoreから取得した物件一覧（生データ）
let propertiesById = {};   // id -> 物件データ（編集時の差分判定に使用）

let filterStaff = '';      // 担当名フィルタ（空文字＝すべて）
let searchText = '';       // 物件名検索
let sortKey = 'settlementDate';
let sortDir = 'asc';

let grossProfitChart = null;
let historyChart = null;
let editingId = null;      // 編集中の物件id（null＝新規登録）
let historyPropertyId = null;

document.addEventListener('DOMContentLoaded', function () {
  bindToolbar();
  bindModals();
  bindSortableHeaders();
  subscribeProperties();
});

// ===== Firestore購読 =====

function subscribeProperties() {
  if (!db) return;
  db.collection('properties').onSnapshot(function (snapshot) {
    properties = [];
    propertiesById = {};
    snapshot.forEach(function (doc) {
      const data = Object.assign({ id: doc.id }, doc.data());
      properties.push(data);
      propertiesById[doc.id] = data;
    });
    render();
  }, function (err) {
    console.error('物件一覧取得エラー:', err);
    showToast('データの取得に失敗しました');
    document.getElementById('property-list-body').innerHTML =
      '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">⚠️</div>データの取得に失敗しました</div></td></tr>';
  });
}

// ===== フィルタ・検索・ソート =====

function bindToolbar() {
  document.getElementById('filter-staff').addEventListener('change', function (e) {
    filterStaff = e.target.value;
    render();
  });
  document.getElementById('search-name').addEventListener('input', function (e) {
    searchText = e.target.value.trim();
    render();
  });
  document.getElementById('add-property-btn').addEventListener('click', function () {
    openPropertyModal(null);
  });
}

function bindSortableHeaders() {
  document.querySelectorAll('#property-table th[data-sort-key]').forEach(function (th) {
    th.addEventListener('click', function () {
      const key = th.getAttribute('data-sort-key');
      if (sortKey === key) {
        sortDir = sortDir === 'asc' ? 'desc' : 'asc';
      } else {
        sortKey = key;
        sortDir = 'asc';
      }
      render();
    });
  });
}

function getFilteredProperties() {
  return properties.filter(function (p) {
    if (filterStaff && p.staff !== filterStaff) return false;
    if (searchText && !(p.name || '').toLowerCase().includes(searchText.toLowerCase())) return false;
    return true;
  });
}

function getSortedProperties(list) {
  const sorted = list.slice();
  sorted.sort(function (a, b) {
    let av = a[sortKey];
    let bv = b[sortKey];
    if (sortKey === 'name' || sortKey === 'staff') {
      av = (av || '').toString();
      bv = (bv || '').toString();
      const cmp = av.localeCompare(bv, 'ja');
      return sortDir === 'asc' ? cmp : -cmp;
    }
    if (sortKey === 'settlementDate' || sortKey === 'priceChangeDate') {
      // 未設定は常に末尾に回す
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    }
    // 数値項目（startPrice / currentPrice / grossProfit）
    av = Number(av) || 0;
    bv = Number(bv) || 0;
    const cmp = av - bv;
    return sortDir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// ===== 担当名フィルタの選択肢を更新 =====

function updateStaffOptions() {
  const select = document.getElementById('filter-staff');
  const staffNames = Array.from(new Set(properties.map(function (p) { return p.staff; }).filter(Boolean))).sort(function (a, b) {
    return a.localeCompare(b, 'ja');
  });
  const current = select.value;
  select.innerHTML = '<option value="">担当：すべて</option>' +
    staffNames.map(function (name) { return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`; }).join('');
  if (staffNames.includes(current)) select.value = current;
}

// ===== 描画 =====

function render() {
  updateStaffOptions();
  const filtered = getFilteredProperties();
  const sorted = getSortedProperties(filtered);

  renderSummary(filtered);
  renderStaffSummary(filtered);
  renderGrossProfitChart(filtered);
  renderTable(sorted);
  updateSortArrows();
}

function renderSummary(list) {
  const count = list.length;
  const totalGrossProfit = list.reduce(function (sum, p) { return sum + (Number(p.grossProfit) || 0); }, 0);
  const dueSoonCount = list.filter(function (p) {
    const alert = getSettlementAlert(p.settlementDate);
    return alert.level === 'warning' || alert.level === 'overdue';
  }).length;

  document.getElementById('stat-count').textContent = count;
  document.getElementById('stat-gross-profit').textContent = totalGrossProfit.toLocaleString('ja-JP');
  document.getElementById('stat-due-soon').textContent = dueSoonCount;
}

function renderStaffSummary(list) {
  const wrap = document.getElementById('staff-summary-list');
  const totals = {};
  list.forEach(function (p) {
    const staff = p.staff || '（未設定）';
    totals[staff] = (totals[staff] || 0) + (Number(p.grossProfit) || 0);
  });
  const names = Object.keys(totals).sort(function (a, b) { return a.localeCompare(b, 'ja'); });

  if (!names.length) {
    wrap.innerHTML = '<div class="form-hint">表示できるデータがありません</div>';
    return;
  }

  wrap.innerHTML = names.map(function (name) {
    return `<div class="staff-summary-item">
      <div class="staff-summary-name">${escapeHtml(name)}</div>
      <div class="staff-summary-value">${formatMan(totals[name])}</div>
    </div>`;
  }).join('');
}

function renderTable(list) {
  const tbody = document.getElementById('property-list-body');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="9"><div class="empty-state"><div class="empty-icon">🏠</div>' +
      (properties.length ? '条件に一致する物件がありません' : '物件が登録されていません') + '</div></td></tr>';
    return;
  }

  tbody.innerHTML = list.map(function (p) {
    const alert = getSettlementAlert(p.settlementDate);
    const rowClass = alert.level === 'overdue' ? 'row-overdue' : alert.level === 'warning' ? 'row-warning' : '';
    const tag = alert.level === 'overdue'
      ? `<span class="tag tag-overdue">${alert.label}</span>`
      : alert.level === 'warning'
        ? `<span class="tag tag-warning">${alert.label}</span>`
        : '';
    return `<tr class="${rowClass}">
      <td class="property-name-cell">${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.staff || '')}</td>
      <td>${formatMan(p.startPrice)}</td>
      <td>${formatMan(p.currentPrice)}</td>
      <td>${formatMan(p.grossProfit)}</td>
      <td>${p.settlementDate ? formatDateJP(p.settlementDate) : '未設定'}</td>
      <td>${p.priceChangeDate ? formatDateJP(p.priceChangeDate) : '－'}</td>
      <td>${tag}</td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" onclick="openHistoryModal('${p.id}')">履歴</button>
          <button class="btn btn-secondary btn-sm" onclick="openPropertyModal('${p.id}')">編集</button>
          <button class="btn btn-danger btn-sm" onclick="deleteProperty('${p.id}')">削除</button>
        </div>
      </td>
    </tr>`;
  }).join('');
}

function updateSortArrows() {
  document.querySelectorAll('#property-table th[data-sort-key]').forEach(function (th) {
    const key = th.getAttribute('data-sort-key');
    const label = th.getAttribute('data-label');
    if (key === sortKey) {
      th.innerHTML = `${label}<span class="sort-arrow">${sortDir === 'asc' ? '▲' : '▼'}</span>`;
    } else {
      th.textContent = label;
    }
  });
}

// ===== 粗利比較グラフ（横棒） =====

function renderGrossProfitChart(list) {
  const canvas = document.getElementById('gross-profit-chart');
  const empty = document.getElementById('gross-profit-chart-empty');
  if (!list.length) {
    canvas.style.display = 'none';
    empty.style.display = 'block';
    if (grossProfitChart) { grossProfitChart.destroy(); grossProfitChart = null; }
    return;
  }
  canvas.style.display = 'block';
  empty.style.display = 'none';

  const sorted = list.slice().sort(function (a, b) { return (Number(b.grossProfit) || 0) - (Number(a.grossProfit) || 0); });
  const labels = sorted.map(function (p) { return p.name; });
  const data = sorted.map(function (p) { return Number(p.grossProfit) || 0; });

  const ctx = canvas.getContext('2d');
  if (grossProfitChart) grossProfitChart.destroy();

  const height = Math.max(160, sorted.length * 32);
  canvas.parentElement.style.height = height + 'px';

  grossProfitChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels,
      datasets: [{
        label: '粗利（万円）',
        data: data,
        backgroundColor: BRAND_COLORS.gold,
        borderRadius: 4,
        maxBarThickness: 22,
      }]
    },
    options: {
      indexAxis: 'y',
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (item) { return formatMan(item.parsed.x); }
          }
        }
      },
      scales: {
        x: { ticks: { color: BRAND_COLORS.navySub }, grid: { color: '#E7ECEF' } },
        y: { ticks: { color: BRAND_COLORS.navy }, grid: { display: false } },
      }
    }
  });
}

// ===== 登録・編集モーダル =====

function bindModals() {
  document.getElementById('property-form').addEventListener('submit', onSubmitPropertyForm);
  document.getElementById('property-modal-close').addEventListener('click', closePropertyModal);
  document.getElementById('property-modal-cancel').addEventListener('click', closePropertyModal);
  document.getElementById('history-modal-close').addEventListener('click', closeHistoryModal);
  document.getElementById('history-modal-ok').addEventListener('click', closeHistoryModal);
}

function openPropertyModal(id) {
  editingId = id;
  const form = document.getElementById('property-form');
  form.reset();

  if (id) {
    const p = propertiesById[id];
    if (!p) return;
    document.getElementById('property-modal-title').textContent = '物件を編集';
    document.getElementById('field-name').value = p.name || '';
    document.getElementById('field-staff').value = p.staff || '';
    document.getElementById('field-startPrice').value = p.startPrice != null ? p.startPrice : '';
    document.getElementById('field-currentPrice').value = p.currentPrice != null ? p.currentPrice : '';
    document.getElementById('field-grossProfit').value = p.grossProfit != null ? p.grossProfit : '';
    document.getElementById('field-settlementDate').value = p.settlementDate || '';
  } else {
    document.getElementById('property-modal-title').textContent = '物件を新規登録';
  }

  document.getElementById('property-modal-overlay').hidden = false;
}

function closePropertyModal() {
  document.getElementById('property-modal-overlay').hidden = true;
  editingId = null;
}

function onSubmitPropertyForm(e) {
  e.preventDefault();
  const name = document.getElementById('field-name').value.trim();
  if (!name) {
    showToast('物件名を入力してください');
    return;
  }
  const staff = document.getElementById('field-staff').value.trim();
  const startPrice = Number(document.getElementById('field-startPrice').value) || 0;
  const currentPrice = Number(document.getElementById('field-currentPrice').value) || 0;
  const grossProfit = Number(document.getElementById('field-grossProfit').value) || 0;
  const settlementDate = document.getElementById('field-settlementDate').value || null;
  const today = getTodayString();

  const submitBtn = document.getElementById('property-modal-submit');
  submitBtn.disabled = true;

  const finish = function () {
    submitBtn.disabled = false;
  };

  if (editingId) {
    const prev = propertiesById[editingId];
    const priceChanged = prev && Number(prev.currentPrice) !== currentPrice;
    let history = (prev && prev.history) ? prev.history.slice() : [];
    let priceChangeDate = (prev && prev.priceChangeDate) || null;
    if (priceChanged) {
      history.push({ date: today, price: currentPrice });
      priceChangeDate = today;
    }
    db.collection('properties').doc(editingId).update({
      name, staff, startPrice, currentPrice, grossProfit, settlementDate,
      history, priceChangeDate,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).then(function () {
      showToast('物件を更新しました');
      closePropertyModal();
    }).catch(function (err) {
      console.error('物件更新エラー:', err);
      showToast('更新に失敗しました');
    }).finally(finish);
  } else {
    db.collection('properties').add({
      name, staff, startPrice, currentPrice, grossProfit, settlementDate,
      history: [{ date: today, price: currentPrice }],
      priceChangeDate: today,
      updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
    }).then(function () {
      showToast('物件を登録しました');
      closePropertyModal();
    }).catch(function (err) {
      console.error('物件登録エラー:', err);
      showToast('登録に失敗しました');
    }).finally(finish);
  }
}

function deleteProperty(id) {
  const p = propertiesById[id];
  if (!p) return;
  if (!confirm(`「${p.name}」を削除します。よろしいですか？`)) return;
  db.collection('properties').doc(id).delete().then(function () {
    showToast('物件を削除しました');
  }).catch(function (err) {
    console.error('物件削除エラー:', err);
    showToast('削除に失敗しました');
  });
}

// ===== 履歴モーダル =====

function openHistoryModal(id) {
  const p = propertiesById[id];
  if (!p) return;
  historyPropertyId = id;

  document.getElementById('history-modal-title').textContent = `${p.name} の価格推移`;
  const rows = computeHistoryWithDiff(p.history);

  const tbody = document.getElementById('history-table-body');
  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="3" class="form-hint">履歴がありません</td></tr>';
  } else {
    tbody.innerHTML = rows.slice().reverse().map(function (row) {
      const diffHtml = row.diff == null
        ? '<span class="diff-zero">初回</span>'
        : row.diff > 0
          ? `<span class="diff-plus">${formatManSigned(row.diff)}</span>`
          : row.diff < 0
            ? `<span class="diff-minus">${formatManSigned(row.diff)}</span>`
            : '<span class="diff-zero">±0万円</span>';
      return `<tr>
        <td>${formatDateJP(row.date)}</td>
        <td>${formatMan(row.price)}</td>
        <td>${diffHtml}</td>
      </tr>`;
    }).join('');
  }

  renderHistoryChart(rows);
  document.getElementById('history-modal-overlay').hidden = false;
}

function closeHistoryModal() {
  document.getElementById('history-modal-overlay').hidden = true;
  historyPropertyId = null;
}

function renderHistoryChart(rows) {
  const canvas = document.getElementById('history-chart');
  const ctx = canvas.getContext('2d');
  if (historyChart) historyChart.destroy();

  if (!rows.length) {
    canvas.style.display = 'none';
    return;
  }
  canvas.style.display = 'block';

  historyChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels: rows.map(function (r) { return formatDateJP(r.date); }),
      datasets: [{
        label: '価格（万円）',
        data: rows.map(function (r) { return r.price; }),
        borderColor: BRAND_COLORS.navy,
        backgroundColor: BRAND_COLORS.navy,
        pointBackgroundColor: BRAND_COLORS.gold,
        pointBorderColor: BRAND_COLORS.gold,
        pointRadius: 4,
        tension: 0.15,
        fill: false,
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (item) { return formatMan(item.parsed.y); }
          }
        }
      },
      scales: {
        x: { ticks: { color: BRAND_COLORS.navySub }, grid: { display: false } },
        y: { ticks: { color: BRAND_COLORS.navySub }, grid: { color: '#E7ECEF' } },
      }
    }
  });
}

// ===== ユーティリティ =====

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
