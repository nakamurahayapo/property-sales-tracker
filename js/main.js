// ============================================================
//  買取再販 物件販売管理アプリ - メインロジック
// ============================================================

let properties = [];       // Firestoreから取得した物件一覧（生データ）
let propertiesById = {};   // id -> 物件データ（編集時の差分判定に使用）

let filterStaff = '';      // 担当名フィルタ（空文字＝すべて）
let searchText = '';       // 物件名検索
let sortKey = 'settlementDate';
let sortDir = 'asc';

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
    let tags = alert.level === 'overdue'
      ? `<span class="tag tag-overdue">${alert.label}</span>`
      : alert.level === 'warning'
        ? `<span class="tag tag-warning">${alert.label}</span>`
        : '';
    if (isPriceReviewDue(p.settlementDate)) {
      tags += `<span class="tag tag-price-review">値下げ検討</span>`;
    }
    return `<tr class="${rowClass}">
      <td class="property-name-cell">${escapeHtml(p.name || '')}</td>
      <td>${escapeHtml(p.staff || '')}</td>
      <td>${formatMan(p.startPrice)}</td>
      <td>${formatMan(p.currentPrice)}</td>
      <td>${formatMan(p.grossProfit)}</td>
      <td>${p.settlementDate ? formatDateJP(p.settlementDate) : '未設定'}</td>
      <td>${p.priceChangeDate ? formatDateJP(p.priceChangeDate) : '－'}</td>
      <td><div class="tag-group">${tags}</div></td>
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

// ===== 粗利比較グラフ（横棒・SVG自前描画） =====
// 外部グラフライブラリは使わず、社内ネットワークでも確実に表示できるようSVGで直接描画する

function renderGrossProfitChart(list) {
  const wrap = document.getElementById('gross-profit-chart-wrap');
  const empty = document.getElementById('gross-profit-chart-empty');
  if (!list.length) {
    wrap.innerHTML = '';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  const sorted = list.slice().sort(function (a, b) { return (Number(b.grossProfit) || 0) - (Number(a.grossProfit) || 0); });

  const rowHeight = 30;
  const barHeight = 16;
  const labelWidth = 150;
  const barAreaWidth = 380;
  const valueColWidth = 90;
  const totalWidth = labelWidth + barAreaWidth + valueColWidth;
  const topPad = 8;
  const height = sorted.length * rowHeight + topPad * 2;
  const maxValue = Math.max(1, ...sorted.map(function (p) { return Math.max(0, Number(p.grossProfit) || 0); }));

  let bars = '';
  sorted.forEach(function (p, i) {
    const value = Number(p.grossProfit) || 0;
    const isNeg = value < 0;
    const rowY = topPad + i * rowHeight;
    const barY = rowY + (rowHeight - barHeight) / 2;
    const w = Math.max(0, value) / maxValue * barAreaWidth;
    const textY = rowY + rowHeight / 2 + 4;
    bars += `
      <text x="${labelWidth - 8}" y="${textY}" text-anchor="end" font-size="12" fill="${BRAND_COLORS.navy}">${escapeHtml(truncateLabel(p.name, 16))}</text>
      <rect x="${labelWidth}" y="${barY}" width="${w}" height="${barHeight}" rx="3" fill="${isNeg ? BRAND_COLORS.danger : BRAND_COLORS.gold}"></rect>
      <text x="${labelWidth + barAreaWidth + 8}" y="${textY}" font-size="12" fill="${isNeg ? BRAND_COLORS.danger : BRAND_COLORS.navySub}">${formatMan(value)}</text>`;
  });

  wrap.innerHTML = `<svg viewBox="0 0 ${totalWidth} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet">${bars}</svg>`;
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

// 価格推移の折れ線グラフ（外部ライブラリなし・SVG自前描画）
function renderHistoryChart(rows) {
  const wrap = document.getElementById('history-chart-wrap');
  if (!rows.length) {
    wrap.innerHTML = '';
    return;
  }

  const width = 560, height = 220;
  const padLeft = 56, padRight = 20, padTop = 16, padBottom = 34;
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const prices = rows.map(function (r) { return r.price; });
  const minP = Math.min.apply(null, prices);
  const maxP = Math.max.apply(null, prices);
  const range = (maxP - minP) || Math.max(1, Math.abs(maxP)) || 1;
  const paddedMin = minP - range * 0.15;
  const paddedMax = maxP + range * 0.15;
  const paddedRange = (paddedMax - paddedMin) || 1;

  const points = rows.map(function (r, i) {
    const x = padLeft + (rows.length === 1 ? innerW / 2 : (i / (rows.length - 1)) * innerW);
    const y = padTop + innerH - ((r.price - paddedMin) / paddedRange) * innerH;
    return { x: x, y: y, row: r };
  });

  const polyline = points.map(function (p) { return p.x.toFixed(1) + ',' + p.y.toFixed(1); }).join(' ');

  // Y軸の目盛り（最小・中央・最大の3本）
  let gridLines = '';
  [0, 0.5, 1].forEach(function (t) {
    const y = padTop + innerH * (1 - t);
    const val = paddedMin + paddedRange * t;
    gridLines += `<line x1="${padLeft}" y1="${y}" x2="${width - padRight}" y2="${y}" stroke="#E7ECEF" stroke-width="1"></line>
      <text x="${padLeft - 8}" y="${y + 4}" text-anchor="end" font-size="10" fill="${BRAND_COLORS.navySub}">${Math.round(val).toLocaleString('ja-JP')}</text>`;
  });

  // X軸の日付ラベル（点が多いときは間引く）
  const labelStep = Math.max(1, Math.ceil(points.length / 6));
  let dots = '', xLabels = '';
  points.forEach(function (p, i) {
    dots += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="4" fill="${BRAND_COLORS.gold}" stroke="${BRAND_COLORS.navy}" stroke-width="1.5"></circle>`;
    if (i === 0 || i === points.length - 1 || i % labelStep === 0) {
      xLabels += `<text x="${p.x.toFixed(1)}" y="${height - padBottom + 16}" text-anchor="middle" font-size="10" fill="${BRAND_COLORS.navySub}">${escapeHtml(formatDateShort(p.row.date))}</text>`;
    }
  });

  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet">
    ${gridLines}
    <polyline points="${polyline}" fill="none" stroke="${BRAND_COLORS.navy}" stroke-width="2"></polyline>
    ${dots}
    ${xLabels}
  </svg>`;
}

// ===== ユーティリティ =====

function truncateLabel(str, maxLen) {
  const s = String(str || '');
  return s.length > maxLen ? s.slice(0, maxLen - 1) + '…' : s;
}

function formatDateShort(dateStr) {
  const date = parseDateOnly(dateStr);
  if (!date) return '';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
