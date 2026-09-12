// ============================================================
//  買取再販 物件販売管理アプリ - メインロジック
//  データモデル：1物件（案件）は複数の区画（lots配列）を持つ。
//  旧形式（区画なし・物件直下に価格等を持つ）のドキュメントは
//  読み込み時に「区画1件」へ自動変換し、保存時に新形式へ移行する。
// ============================================================

let properties = [];       // Firestoreから取得した物件一覧（各要素は正規化済みで必ず lots 配列を持つ）
let propertiesById = {};   // id -> 物件データ（編集時の差分判定に使用）

let filterStaff = '';      // 担当名フィルタ（空文字＝すべて）
let filterStatus = 'active'; // 状態フィルタ：'active'（販売中のみ・既定）／'sold'（成約済みのみ）／'all'（すべて）
let searchText = '';       // 物件名・区画名検索
let sortKey = 'settlementDate';
let sortDir = 'asc';

let editingId = null;      // 編集中の物件id（null＝新規登録）
let editingLots = [];      // 編集モーダル内で操作中の区画データ（配列）
let historyPropertyId = null;
let historyLotId = null;

document.addEventListener('DOMContentLoaded', function () {
  bindToolbar();
  bindModals();
  bindSortableHeaders();
  subscribeProperties();
});

// ===== ID生成（区画の識別用） =====

function generateId() {
  return 'lot_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ===== 旧形式（区画なし）ドキュメントの正規化 =====
// 物件ドキュメントに lots 配列がなければ、物件直下の旧フィールドから区画1件を合成する。
// 保存（更新）時には新形式（lots配列のみ）で書き込み、旧フィールドは削除する。
function normalizeProperty(data) {
  if (Array.isArray(data.lots) && data.lots.length) {
    data.lots = data.lots.map(function (lot) {
      return Object.assign({ id: lot.id || generateId(), lotName: lot.lotName || '', history: lot.history || [], status: 'active' }, lot);
    });
    return data;
  }
  data.lots = [{
    id: 'legacy',
    lotName: '',
    staff: data.staff || '',
    startPrice: data.startPrice || 0,
    currentPrice: data.currentPrice || 0,
    grossProfit: data.grossProfit || 0,
    settlementDate: data.settlementDate || null,
    salesStartDate: data.salesStartDate || null,
    priceChangeDate: data.priceChangeDate || null,
    history: data.history || [],
    status: 'active',
  }];
  return data;
}

// ===== Firestore購読 =====

function subscribeProperties() {
  if (!db) return;
  db.collection('properties').onSnapshot(function (snapshot) {
    properties = [];
    propertiesById = {};
    snapshot.forEach(function (doc) {
      const data = normalizeProperty(Object.assign({ id: doc.id }, doc.data()));
      properties.push(data);
      propertiesById[doc.id] = data;
    });
    render();
  }, function (err) {
    console.error('物件一覧取得エラー:', err);
    showToast('データの取得に失敗しました');
    document.getElementById('property-list-body').innerHTML =
      '<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">⚠️</div>データの取得に失敗しました</div></td></tr>';
  });
}

// ===== 物件→区画への平坦化 =====
// 一覧・グラフ・集計はすべて「区画」を1行として扱う（1物件＝複数行になり得る）

function flattenLots() {
  const rows = [];
  properties.forEach(function (p) {
    (p.lots || []).forEach(function (lot) {
      rows.push(Object.assign({}, lot, {
        propertyId: p.id,
        propertyName: p.name || '',
        isOnlyLot: (p.lots || []).length <= 1,
      }));
    });
  });
  return rows;
}

// ===== フィルタ・検索・ソート =====

function bindToolbar() {
  document.getElementById('filter-staff').addEventListener('change', function (e) {
    filterStaff = e.target.value;
    render();
  });
  document.getElementById('filter-status').addEventListener('change', function (e) {
    filterStatus = e.target.value;
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

function getFilteredRows(rows) {
  const needle = searchText.toLowerCase();
  return rows.filter(function (r) {
    if (filterStaff && r.staff !== filterStaff) return false;
    if (filterStatus !== 'all' && (r.status || 'active') !== filterStatus) return false;
    if (needle) {
      const haystack = ((r.propertyName || '') + ' ' + (r.lotName || '')).toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

function getSortedRows(list) {
  const sorted = list.slice();
  sorted.sort(function (a, b) {
    let av, bv;
    if (sortKey === 'name') {
      // 物件名でまとめて並ぶよう、物件名→区画名の順で比較する
      const cmp = (a.propertyName || '').localeCompare(b.propertyName || '', 'ja')
        || (a.lotName || '').localeCompare(b.lotName || '', 'ja');
      return sortDir === 'asc' ? cmp : -cmp;
    }
    if (sortKey === 'lotName' || sortKey === 'staff') {
      av = (a[sortKey] || '').toString();
      bv = (b[sortKey] || '').toString();
      const cmp = av.localeCompare(bv, 'ja');
      return sortDir === 'asc' ? cmp : -cmp;
    }
    if (sortKey === 'settlementDate' || sortKey === 'salesStartDate' || sortKey === 'priceChangeDate') {
      av = a[sortKey]; bv = b[sortKey];
      // 未設定は常に末尾に回す
      if (!av && !bv) return 0;
      if (!av) return 1;
      if (!bv) return -1;
      const cmp = av < bv ? -1 : av > bv ? 1 : 0;
      return sortDir === 'asc' ? cmp : -cmp;
    }
    // 数値項目（startPrice / currentPrice / grossProfit）
    av = Number(a[sortKey]) || 0;
    bv = Number(b[sortKey]) || 0;
    const cmp = av - bv;
    return sortDir === 'asc' ? cmp : -cmp;
  });
  return sorted;
}

// ===== 担当名フィルタの選択肢を更新 =====

function updateStaffOptions(rows) {
  const select = document.getElementById('filter-staff');
  const staffNames = Array.from(new Set(rows.map(function (r) { return r.staff; }).filter(Boolean))).sort(function (a, b) {
    return a.localeCompare(b, 'ja');
  });
  const current = select.value;
  select.innerHTML = '<option value="">担当：すべて</option>' +
    staffNames.map(function (name) { return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`; }).join('');
  if (staffNames.includes(current)) select.value = current;
}

// ===== 描画 =====

function render() {
  const allRows = flattenLots();
  updateStaffOptions(allRows);
  const filtered = getFilteredRows(allRows);
  const sorted = getSortedRows(filtered);

  renderSummary(filtered);
  renderStaffSummary(filtered);
  renderGrossProfitChart(filtered);
  renderTable(sorted);
  updateSortArrows();
}

function renderSummary(list) {
  // list は区画（lot）単位。「物件数」は区画数と別物なので、区画が属する物件の重複なし件数を数える
  const propertyCount = new Set(list.map(function (r) { return r.propertyId; })).size;
  const lotCount = list.length;
  const totalGrossProfit = list.reduce(function (sum, r) { return sum + (Number(r.grossProfit) || 0); }, 0);
  const dueSoonCount = list.filter(function (r) {
    const alert = getSettlementAlert(r.settlementDate);
    return alert.level === 'warning' || alert.level === 'overdue';
  }).length;

  document.getElementById('stat-count').textContent = propertyCount;
  document.getElementById('stat-lot-count').textContent = lotCount;
  document.getElementById('stat-gross-profit').textContent = totalGrossProfit.toLocaleString('ja-JP');
  document.getElementById('stat-due-soon').textContent = dueSoonCount;
}

function renderStaffSummary(list) {
  const wrap = document.getElementById('staff-summary-list');
  const totals = {};
  list.forEach(function (r) {
    const staff = r.staff || '（未設定）';
    totals[staff] = (totals[staff] || 0) + (Number(r.grossProfit) || 0);
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

// 区画の表示名（物件名＋区画名。区画名が空なら物件名のみ）
function rowDisplayName(r) {
  return r.lotName ? `${r.propertyName} / ${r.lotName}` : r.propertyName;
}

function renderTable(list) {
  const tbody = document.getElementById('property-list-body');

  if (!list.length) {
    tbody.innerHTML = '<tr><td colspan="11"><div class="empty-state"><div class="empty-icon">🏠</div>' +
      (properties.length ? '条件に一致する物件がありません' : '物件が登録されていません') + '</div></td></tr>';
    return;
  }

  // 物件名でソートしているときだけ、同じ物件の区画が並びで隣接するので、
  // 物件ごとの小計行（表示中の区画数・成約内訳・合計粗利）を挟んで見やすくする
  if (sortKey === 'name') {
    let html = '';
    let i = 0;
    while (i < list.length) {
      const pid = list[i].propertyId;
      const group = [];
      while (i < list.length && list[i].propertyId === pid) { group.push(list[i]); i++; }
      if (group.length > 1) html += renderPropertyGroupRow(group);
      html += group.map(renderLotRow).join('');
    }
    tbody.innerHTML = html;
  } else {
    tbody.innerHTML = list.map(renderLotRow).join('');
  }
}

// 物件ごとの小計行（同じ物件名でまとまっている区画が2件以上のときだけ表示）
function renderPropertyGroupRow(group) {
  const soldCount = group.filter(function (r) { return r.status === 'sold'; }).length;
  const totalGrossProfit = group.reduce(function (sum, r) { return sum + (Number(r.grossProfit) || 0); }, 0);
  return `<tr class="property-group-row">
    <td colspan="11">
      <span class="property-group-name">${escapeHtml(group[0].propertyName)}</span>
      <span class="property-group-meta">表示中${group.length}区画（成約済み${soldCount}／販売中${group.length - soldCount}）・表示区画合計粗利 ${formatMan(totalGrossProfit)}</span>
    </td>
  </tr>`;
}

function renderLotRow(r) {
  const isSold = r.status === 'sold';
  const alert = isSold ? { level: 'normal', label: '' } : getSettlementAlert(r.settlementDate);
  const rowClass = isSold ? 'row-sold' : alert.level === 'overdue' ? 'row-overdue' : alert.level === 'warning' ? 'row-warning' : '';
  let tags = alert.level === 'overdue'
    ? `<span class="tag tag-overdue">${alert.label}</span>`
    : alert.level === 'warning'
      ? `<span class="tag tag-warning">${alert.label}</span>`
      : '';
  const reviewStage = isSold ? null : getPriceReviewStageDue(r.settlementDate);
  if (reviewStage) {
    const stageLabel = PRICE_REVIEW_STAGE_LABELS[reviewStage - 1] || `${reviewStage}回目`;
    tags += `<span class="tag tag-price-review">値下げ検討${stageLabel}</span>`;
  }
  if (isSold) tags += `<span class="tag tag-sold">成約済み</span>`;
  return `<tr class="${rowClass}">
      <td class="property-name-cell">${escapeHtml(r.propertyName || '')}</td>
      <td>${escapeHtml(r.lotName || '－')}</td>
      <td>${escapeHtml(r.staff || '')}</td>
      <td>${formatMan(r.startPrice)}</td>
      <td>${formatMan(r.currentPrice)}</td>
      <td>${formatMan(r.grossProfit)}</td>
      <td>${r.settlementDate ? formatDateJP(r.settlementDate) : '未設定'}</td>
      <td>${r.salesStartDate ? formatDateJP(r.salesStartDate) : '－'}</td>
      <td>${r.priceChangeDate ? formatDateJP(r.priceChangeDate) : '－'}</td>
      <td><div class="tag-group">${tags}</div></td>
      <td>
        <div class="row-actions">
          <button class="btn btn-secondary btn-sm" onclick="openHistoryModal('${r.propertyId}','${r.id}')">履歴</button>
          <button class="btn btn-secondary btn-sm" onclick="openPropertyModal('${r.propertyId}')">編集</button>
          <button class="btn btn-secondary btn-sm" onclick="toggleLotStatus('${r.propertyId}','${r.id}')">${isSold ? '販売中に戻す' : '成約済みにする'}</button>
          <button class="btn btn-danger btn-sm" onclick="deleteLot('${r.propertyId}','${r.id}')">削除</button>
        </div>
      </td>
    </tr>`;
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
  const maxValue = Math.max(1, ...sorted.map(function (r) { return Math.max(0, Number(r.grossProfit) || 0); }));

  let bars = '';
  sorted.forEach(function (r, i) {
    const value = Number(r.grossProfit) || 0;
    const isNeg = value < 0;
    const rowY = topPad + i * rowHeight;
    const barY = rowY + (rowHeight - barHeight) / 2;
    const w = Math.max(0, value) / maxValue * barAreaWidth;
    const textY = rowY + rowHeight / 2 + 4;
    bars += `
      <text x="${labelWidth - 8}" y="${textY}" text-anchor="end" font-size="12" fill="${BRAND_COLORS.navy}">${escapeHtml(truncateLabel(rowDisplayName(r), 16))}</text>
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
  document.getElementById('add-lot-btn').addEventListener('click', function () {
    editingLots.push(emptyLot());
    renderLotsEditor();
  });
  const onLotFieldChange = function (e) {
    const field = e.target.getAttribute('data-field');
    const index = Number(e.target.getAttribute('data-lot-index'));
    if (field == null || Number.isNaN(index) || !editingLots[index]) return;
    editingLots[index][field] = e.target.value;
  };
  // input要素は'input'、select要素（ステータス）は'change'で発火するため両方拾う
  document.getElementById('lots-container').addEventListener('input', onLotFieldChange);
  document.getElementById('lots-container').addEventListener('change', onLotFieldChange);
  document.getElementById('lots-container').addEventListener('click', function (e) {
    const btn = e.target.closest('.lot-remove-btn');
    if (!btn) return;
    const index = Number(btn.getAttribute('data-lot-index'));
    if (Number.isNaN(index) || editingLots.length <= 1) return;
    editingLots.splice(index, 1);
    renderLotsEditor();
  });
  document.getElementById('property-modal-delete-all').addEventListener('click', function () {
    if (!editingId) return;
    deleteProperty(editingId);
  });
  document.getElementById('history-modal-close').addEventListener('click', closeHistoryModal);
  document.getElementById('history-modal-ok').addEventListener('click', closeHistoryModal);
}

function emptyLot() {
  return {
    id: generateId(),
    lotName: '', staff: '', startPrice: '', currentPrice: '', grossProfit: '',
    settlementDate: '', salesStartDate: '', status: 'active', priceChangeDateInput: '',
  };
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
    editingLots = (p.lots || []).map(function (lot) {
      return {
        id: lot.id,
        lotName: lot.lotName || '',
        staff: lot.staff || '',
        startPrice: lot.startPrice != null ? lot.startPrice : '',
        currentPrice: lot.currentPrice != null ? lot.currentPrice : '',
        grossProfit: lot.grossProfit != null ? lot.grossProfit : '',
        settlementDate: lot.settlementDate || '',
        salesStartDate: lot.salesStartDate || '',
        status: lot.status === 'sold' ? 'sold' : 'active',
        priceChangeDateInput: '',
      };
    });
    document.getElementById('property-modal-delete-all').hidden = false;
  } else {
    document.getElementById('property-modal-title').textContent = '物件を新規登録';
    editingLots = [emptyLot()];
    document.getElementById('property-modal-delete-all').hidden = true;
  }

  renderLotsEditor();
  document.getElementById('property-modal-overlay').hidden = false;
}

function renderLotsEditor() {
  const container = document.getElementById('lots-container');
  const onlyOneLot = editingLots.length <= 1;
  container.innerHTML = editingLots.map(function (lot, i) {
    return `<div class="lot-fieldset" data-lot-index="${i}">
      <div class="lot-fieldset-header">
        <span class="lot-fieldset-title">区画 ${i + 1}</span>
        <button type="button" class="btn btn-danger btn-sm lot-remove-btn" data-lot-index="${i}" ${onlyOneLot ? 'disabled' : ''}>この区画を削除</button>
      </div>
      <div class="form-group">
        <label class="form-label">区画名（号地など。1区画のみなら空欄でOK）</label>
        <input type="text" class="lot-field" data-field="lotName" data-lot-index="${i}" value="${escapeHtmlAttr(lot.lotName)}">
      </div>
      <div class="form-group">
        <label class="form-label">担当名</label>
        <input type="text" class="lot-field" data-field="staff" data-lot-index="${i}" value="${escapeHtmlAttr(lot.staff)}">
      </div>
      <div class="form-group">
        <label class="form-label">ステータス</label>
        <select class="lot-field" data-field="status" data-lot-index="${i}">
          <option value="active" ${lot.status === 'sold' ? '' : 'selected'}>販売中</option>
          <option value="sold" ${lot.status === 'sold' ? 'selected' : ''}>成約済み</option>
        </select>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">販売開始価格（万円）</label>
          <input type="number" step="1" class="lot-field" data-field="startPrice" data-lot-index="${i}" value="${escapeHtmlAttr(lot.startPrice)}">
        </div>
        <div class="form-group">
          <label class="form-label">現在価格（万円）</label>
          <input type="number" step="1" class="lot-field" data-field="currentPrice" data-lot-index="${i}" value="${escapeHtmlAttr(lot.currentPrice)}">
          <div class="form-hint">保存時に前回と値が変われば価格変更履歴に自動追加されます</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">価格変更日</label>
          <input type="date" class="lot-field" data-field="priceChangeDateInput" data-lot-index="${i}" value="${escapeHtmlAttr(lot.priceChangeDateInput)}">
          <div class="form-hint">価格を変更する場合の変更日。空欄なら本日の日付になります</div>
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">粗利（万円）</label>
          <input type="number" step="1" class="lot-field" data-field="grossProfit" data-lot-index="${i}" value="${escapeHtmlAttr(lot.grossProfit)}">
        </div>
        <div class="form-group">
          <label class="form-label">仕入決済予定日</label>
          <input type="date" class="lot-field" data-field="settlementDate" data-lot-index="${i}" value="${escapeHtmlAttr(lot.settlementDate)}">
        </div>
      </div>
      <div class="form-row">
        <div class="form-group">
          <label class="form-label">販売開始日</label>
          <input type="date" class="lot-field" data-field="salesStartDate" data-lot-index="${i}" value="${escapeHtmlAttr(lot.salesStartDate)}">
        </div>
      </div>
    </div>`;
  }).join('');
}

function closePropertyModal() {
  document.getElementById('property-modal-overlay').hidden = true;
  editingId = null;
  editingLots = [];
}

function onSubmitPropertyForm(e) {
  e.preventDefault();
  const name = document.getElementById('field-name').value.trim();
  if (!name) {
    showToast('物件名を入力してください');
    return;
  }
  if (!editingLots.length) {
    showToast('区画を1件以上登録してください');
    return;
  }

  const today = getTodayString();
  const prev = editingId ? propertiesById[editingId] : null;
  const prevLotsById = {};
  (prev && prev.lots || []).forEach(function (lot) { prevLotsById[lot.id] = lot; });

  const newLots = editingLots.map(function (lot) {
    const currentPrice = Number(lot.currentPrice) || 0;
    const changeDate = (lot.priceChangeDateInput || '').trim() || today;
    const prevLot = prevLotsById[lot.id];
    let history, priceChangeDate;
    if (!prevLot) {
      // 新規区画（新規物件、または編集中に追加された区画）：初回登録として履歴を開始
      history = [{ date: changeDate, price: currentPrice }];
      priceChangeDate = changeDate;
    } else {
      const priceChanged = Number(prevLot.currentPrice) !== currentPrice;
      history = (prevLot.history || []).slice();
      priceChangeDate = prevLot.priceChangeDate || null;
      if (priceChanged) {
        history.push({ date: changeDate, price: currentPrice });
        priceChangeDate = changeDate;
      }
    }
    return {
      id: lot.id,
      lotName: (lot.lotName || '').trim(),
      staff: (lot.staff || '').trim(),
      startPrice: Number(lot.startPrice) || 0,
      currentPrice,
      grossProfit: Number(lot.grossProfit) || 0,
      settlementDate: lot.settlementDate || null,
      salesStartDate: lot.salesStartDate || null,
      status: lot.status === 'sold' ? 'sold' : 'active',
      history,
      priceChangeDate,
    };
  });

  const submitBtn = document.getElementById('property-modal-submit');
  submitBtn.disabled = true;
  const finish = function () { submitBtn.disabled = false; };

  if (editingId) {
    // 旧形式で残っていた物件直下のフィールドは新形式（lots配列）への移行のため削除する
    const del = firebase.firestore.FieldValue.delete();
    db.collection('properties').doc(editingId).update({
      name, lots: newLots,
      staff: del, startPrice: del, currentPrice: del, grossProfit: del,
      settlementDate: del, salesStartDate: del, priceChangeDate: del, history: del,
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
      name, lots: newLots,
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

// 物件を丸ごと削除（全区画）
function deleteProperty(id) {
  const p = propertiesById[id];
  if (!p) return;
  if (!confirm(`「${p.name}」を区画ごとすべて削除します。よろしいですか？`)) return;
  db.collection('properties').doc(id).delete().then(function () {
    showToast('物件を削除しました');
    if (editingId === id) closePropertyModal();
  }).catch(function (err) {
    console.error('物件削除エラー:', err);
    showToast('削除に失敗しました');
  });
}

// 区画を1件だけ削除。その物件に残る区画がなくなる場合は物件ごと削除する
function deleteLot(propertyId, lotId) {
  const p = propertiesById[propertyId];
  if (!p) return;
  const lot = (p.lots || []).find(function (l) { return l.id === lotId; });
  if (!lot) return;
  const label = lot.lotName ? `${p.name} / ${lot.lotName}` : p.name;

  if ((p.lots || []).length <= 1) {
    if (!confirm(`「${label}」を削除します（この物件最後の区画のため物件ごと削除されます）。よろしいですか？`)) return;
    db.collection('properties').doc(propertyId).delete().then(function () {
      showToast('物件を削除しました');
    }).catch(function (err) {
      console.error('物件削除エラー:', err);
      showToast('削除に失敗しました');
    });
    return;
  }

  if (!confirm(`区画「${label}」を削除します。よろしいですか？`)) return;
  const newLots = p.lots.filter(function (l) { return l.id !== lotId; });
  db.collection('properties').doc(propertyId).update({
    lots: newLots,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).then(function () {
    showToast('区画を削除しました');
  }).catch(function (err) {
    console.error('区画削除エラー:', err);
    showToast('削除に失敗しました');
  });
}

// 区画のステータス（販売中／成約済み）を切り替える。成約済みにしても削除ではないため
// 実績（合計粗利・件数）や履歴はそのまま残り、状態フィルタで「成約済み」「すべて」を選べば集計できる
function toggleLotStatus(propertyId, lotId) {
  const p = propertiesById[propertyId];
  if (!p) return;
  const lot = (p.lots || []).find(function (l) { return l.id === lotId; });
  if (!lot) return;
  const nextStatus = lot.status === 'sold' ? 'active' : 'sold';
  const newLots = p.lots.map(function (l) {
    return l.id === lotId ? Object.assign({}, l, { status: nextStatus }) : l;
  });
  db.collection('properties').doc(propertyId).update({
    lots: newLots,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).then(function () {
    showToast(nextStatus === 'sold' ? '成約済みにしました' : '販売中に戻しました');
  }).catch(function (err) {
    console.error('ステータス更新エラー:', err);
    showToast('更新に失敗しました');
  });
}

// ===== 履歴モーダル =====

function openHistoryModal(propertyId, lotId) {
  const p = propertiesById[propertyId];
  if (!p) return;
  const lot = (p.lots || []).find(function (l) { return l.id === lotId; });
  if (!lot) return;
  historyPropertyId = propertyId;
  historyLotId = lotId;

  const displayName = lot.lotName ? `${p.name} / ${lot.lotName}` : p.name;
  document.getElementById('history-modal-title').textContent = `${displayName} の価格推移`;
  const rows = computeHistoryWithDiff(lot.history);

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

  renderHistoryChart(rows, lot.settlementDate);
  document.getElementById('history-modal-overlay').hidden = false;
}

function closeHistoryModal() {
  document.getElementById('history-modal-overlay').hidden = true;
  historyPropertyId = null;
  historyLotId = null;
}

// 価格推移の折れ線グラフ（外部ライブラリなし・SVG自前描画）
// settlementDate（仕入決済予定日）が設定されていれば、そこから1ヶ月半ごと・半年後までの
// 値下げ検討予定日を縦の点線で重ねて表示する。x軸は日付の実際の間隔に比例させ、各予定日の位置も正しく反映する
function renderHistoryChart(rows, settlementDate) {
  const wrap = document.getElementById('history-chart-wrap');
  if (!rows.length) {
    wrap.innerHTML = '';
    return;
  }

  const width = 560, height = 220;
  const reviewSchedule = getPriceReviewSchedule(settlementDate) || [];
  // 予定日ラベルを段数分だけ縦に積むため、件数に応じて上部余白を広げる（最低34px）
  const padLeft = 56, padRight = 20, padBottom = 34;
  const padTop = Math.max(34, 14 + reviewSchedule.length * 13 + 6);
  const innerW = width - padLeft - padRight;
  const innerH = height - padTop - padBottom;

  const historyDates = rows.map(function (r) { return parseDateOnly(r.date); });
  const allTimes = historyDates.concat(reviewSchedule.map(function (item) { return item.date; }))
    .map(function (d) { return d.getTime(); });
  const minTime = Math.min.apply(null, allTimes);
  const maxTime = Math.max.apply(null, allTimes);
  const timeSpan = maxTime - minTime;

  function xForTime(t) {
    if (timeSpan === 0) return padLeft + innerW / 2;
    return padLeft + ((t - minTime) / timeSpan) * innerW;
  }

  const prices = rows.map(function (r) { return r.price; });
  const minP = Math.min.apply(null, prices);
  const maxP = Math.max.apply(null, prices);
  const range = (maxP - minP) || Math.max(1, Math.abs(maxP)) || 1;
  const paddedMin = minP - range * 0.15;
  const paddedMax = maxP + range * 0.15;
  const paddedRange = (paddedMax - paddedMin) || 1;

  function yForPrice(price) {
    return padTop + innerH - ((price - paddedMin) / paddedRange) * innerH;
  }

  const points = rows.map(function (r, i) {
    return { x: xForTime(historyDates[i].getTime()), y: yForPrice(r.price), row: r };
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

  // 値下げ検討予定日（仕入決済予定日から1ヶ月半ごと・半年後まで）の縦線マーカー
  // 到来済みの予定日は危険色の実線的な強調、未到来の予定日はゴールドで区別する
  const today = parseDateOnly(getTodayString());
  let reviewMarker = '';
  reviewSchedule.forEach(function (item, i) {
    const rx = xForTime(item.date.getTime());
    const labelOnRight = rx < width / 2;
    const anchor = labelOnRight ? 'start' : 'end';
    const labelX = labelOnRight ? rx + 6 : rx - 6;
    const labelY = 11 + i * 13;
    const isDue = today >= item.date;
    const color = isDue ? BRAND_COLORS.danger : BRAND_COLORS.gold;
    const stageLabel = PRICE_REVIEW_STAGE_LABELS[item.stage - 1] || `${item.stage}回目`;
    reviewMarker += `
      <line x1="${rx.toFixed(1)}" y1="14" x2="${rx.toFixed(1)}" y2="${height - padBottom}" stroke="${color}" stroke-width="1.5" stroke-dasharray="4,3"></line>
      <text x="${labelX.toFixed(1)}" y="${labelY}" text-anchor="${anchor}" font-size="11" font-weight="700" fill="${color}">${stageLabel} ${escapeHtml(formatDateShortFromDate(item.date))}</text>`;
  });

  wrap.innerHTML = `<svg viewBox="0 0 ${width} ${height}" width="100%" height="${height}" preserveAspectRatio="xMinYMin meet">
    ${gridLines}
    ${reviewMarker}
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
  return formatDateShortFromDate(date);
}

function formatDateShortFromDate(date) {
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function escapeHtml(str) {
  return String(str || '').replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

// フォーム入力欄のvalue属性用（0やnullを空文字と区別せず安全に埋め込む）
function escapeHtmlAttr(value) {
  return escapeHtml(value == null ? '' : value);
}
