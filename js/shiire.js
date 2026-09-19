// ============================================================
//  仕入パイプラインボード
//  Firestore コレクション：shiireCases
//  config.js の db / formatMan / parseDateOnly / getSettlementAlert /
//  showToast をそのまま利用する。
// ============================================================

const STAGES = ['見当初期', '買付中', '契約', '決済'];

const PERSON_PALETTE = [
  '#2C4A5E', '#D9922E', '#5B7F92', '#B8763D', '#4C7A5E', '#8C5B7A',
];
const personColorCache = {};
function colorForPerson(name) {
  if (personColorCache[name]) return personColorCache[name];
  const keys = Object.keys(personColorCache);
  const color = PERSON_PALETTE[keys.length % PERSON_PALETTE.length];
  personColorCache[name] = color;
  return color;
}

let allCases = [];
let activePerson = '全員';
let showDropped = false;
let editingId = null;
let unsubscribe = null;

const shiireCol = db ? db.collection('shiireCases') : null;

// ===== Firestore 読み込み =====

function initShiire() {
  if (!shiireCol) {
    document.getElementById('lanes').innerHTML =
      '<div class="empty-state"><div class="empty-icon">⚠️</div>Firebaseに接続できません</div>';
    return;
  }
  unsubscribe = shiireCol.onSnapshot(
    (snapshot) => {
      allCases = snapshot.docs.map((doc) => docToCase(doc));
      render();
    },
    (err) => {
      console.error(err);
      showToast('データの読み込みに失敗しました');
    }
  );
}

function docToCase(doc) {
  const d = doc.data() || {};
  return {
    id: doc.id,
    person: d.person || '未設定',
    name: d.name || '(物件名未入力)',
    stage: STAGES.includes(d.stage) ? d.stage : '見当初期',
    mokusen: d.mokusen != null ? Number(d.mokusen) : null,
    price: d.price != null ? Number(d.price) : null,
    area: d.area || '',
    checked: !!d.checked,
    dropped: !!d.dropped,
    contractDate: d.contractDate || '',
    settlementDate: d.settlementDate || '',
  };
}

function saveCase(id, fields) {
  const payload = Object.assign({}, fields, { updatedAt: firebase.firestore.FieldValue.serverTimestamp() });
  return shiireCol.doc(id).set(payload)
    .then(() => showToast('保存しました'))
    .catch((err) => { console.error(err); showToast('保存に失敗しました'); });
}

function deleteCase(id) {
  return shiireCol.doc(id).delete()
    .then(() => showToast('削除しました'))
    .catch((err) => { console.error(err); showToast('削除に失敗しました'); });
}

// ===== 派生データ =====

function allPeople() {
  const seen = {};
  const out = [];
  allCases.forEach((c) => {
    if (!seen[c.person]) { seen[c.person] = true; out.push(c.person); }
  });
  return out;
}

function visibleCases() {
  return allCases.filter((c) => {
    if (c.dropped && !showDropped) return false;
    if (activePerson !== '全員' && c.person !== activePerson) return false;
    return true;
  });
}

// ===== 描画 =====

function render() {
  renderChips();
  renderLanes();
  renderStats();
  document.getElementById('add-case-btn').disabled = !shiireCol;
}

function renderChips() {
  const wrap = document.getElementById('person-chips');
  wrap.innerHTML = '';
  const people = ['全員'].concat(allPeople());

  people.forEach((p) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'chip';
    chip.setAttribute('aria-pressed', String(p === activePerson));
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    if (p !== '全員') dot.style.background = colorForPerson(p);
    chip.appendChild(dot);
    chip.appendChild(document.createTextNode(p));
    chip.addEventListener('click', () => { activePerson = p; render(); });
    wrap.appendChild(chip);
  });

  renderPersonSelect();
}

function renderPersonSelect() {
  const select = document.getElementById('field-person');
  const current = select.value;
  select.innerHTML = '';
  allPeople().forEach((p) => {
    const opt = document.createElement('option');
    opt.value = p;
    opt.textContent = p;
    select.appendChild(opt);
  });
  const newOpt = document.createElement('option');
  newOpt.value = '__new__';
  newOpt.textContent = '＋ 新しい担当者を追加';
  select.appendChild(newOpt);
  if (current && [...select.options].some((o) => o.value === current)) {
    select.value = current;
  }
}

function renderLanes() {
  const lanesEl = document.getElementById('lanes');
  lanesEl.innerHTML = '';
  const recs = visibleCases();

  if (!recs.length) {
    lanesEl.innerHTML = '<div class="empty-state"><div class="empty-icon">📋</div>表示できる案件がありません</div>';
    return;
  }

  const people = allPeople().filter((p) => recs.some((c) => c.person === p));

  people.forEach((person) => {
    const personCases = recs.filter((c) => c.person === person);
    const color = colorForPerson(person);

    const lane = document.createElement('section');
    lane.className = 'lane';

    const head = document.createElement('div');
    head.className = 'lane-head';
    const badge = document.createElement('span');
    badge.className = 'badge-person';
    badge.style.background = color;
    badge.style.color = '#fff';
    const dot = document.createElement('span');
    dot.className = 'chip-dot';
    dot.style.background = 'rgba(255,255,255,0.85)';
    badge.appendChild(dot);
    badge.appendChild(document.createTextNode(person));
    head.appendChild(badge);

    const total = document.createElement('span');
    total.className = 'lane-total';
    const amountSum = personCases.reduce((s, c) => s + (c.price || 0), 0);
    total.innerHTML = `<b>${personCases.length}</b>件 ／ 合計 <b>${formatMan(amountSum)}</b>`;
    head.appendChild(total);
    lane.appendChild(head);

    const stagesWrap = document.createElement('div');
    stagesWrap.className = 'lane-stages';

    STAGES.forEach((stage) => {
      const stageCases = personCases.filter((c) => c.stage === stage);

      const cell = document.createElement('div');
      cell.className = 'stage-cell';

      const cellHead = document.createElement('div');
      cellHead.className = 'stage-cell-head';
      cellHead.setAttribute('data-stage', stage);
      cellHead.innerHTML = `<span>${stage}</span><span class="seg-count">${stageCases.length}</span>`;
      cell.appendChild(cellHead);

      const body = document.createElement('div');
      body.className = 'stage-cell-body';
      if (!stageCases.length) {
        body.innerHTML = '<div class="cell-empty">—</div>';
      } else {
        stageCases.forEach((c) => body.appendChild(renderCard(c, stage)));
      }
      cell.appendChild(body);
      stagesWrap.appendChild(cell);
    });

    lane.appendChild(stagesWrap);
    lanesEl.appendChild(lane);
  });
}

function renderCard(c, stage) {
  const card = document.createElement('div');
  card.className = 'case-card' + (c.dropped ? ' dropped' : '');

  const name = document.createElement('div');
  name.className = 'case-name';
  name.textContent = c.name;
  card.appendChild(name);

  const figRow = document.createElement('div');
  figRow.className = 'case-fig-row';
  if (stage === '見当初期') {
    figRow.innerHTML += `<span>目線 <b>${formatMan(c.mokusen)}</b></span>`;
  }
  const priceLabel = stage === '買付中' ? '金額' : (stage === '見当初期' ? '試算' : '価格');
  figRow.innerHTML += `<span>${priceLabel} <b>${formatMan(c.price)}</b></span>`;
  if (c.area) figRow.innerHTML += `<span>面積 <b>${escapeHtml(c.area)}</b></span>`;
  if (stage === '契約' && c.contractDate) figRow.innerHTML += `<span>契約日 <b>${formatDateJP(c.contractDate)}</b></span>`;
  if (stage === '決済' && c.settlementDate) {
    const alert = getSettlementAlert(c.settlementDate);
    const cls = alert.level === 'overdue' ? 'diff-plus' : (alert.level === 'warning' ? 'diff-plus' : '');
    figRow.innerHTML += `<span>決済予定 <b class="${cls}">${formatDateJP(c.settlementDate)}${alert.label ? '（' + alert.label + '）' : ''}</b></span>`;
  }
  card.appendChild(figRow);

  const tags = document.createElement('div');
  tags.className = 'case-tags';
  if (stage === '見当初期') {
    const t = document.createElement('span');
    t.className = 'tag ' + (c.checked ? 'tag-check' : 'tag-uncheck');
    t.textContent = c.checked ? '現地確認済' : '現地未確認';
    tags.appendChild(t);
  }
  if (c.dropped) {
    const t = document.createElement('span');
    t.className = 'tag tag-sold';
    t.textContent = '没';
    tags.appendChild(t);
  }
  if (tags.childNodes.length) card.appendChild(tags);

  const actions = document.createElement('div');
  actions.className = 'case-actions';
  const idx = STAGES.indexOf(stage);

  const back = document.createElement('button');
  back.type = 'button';
  back.className = 'icon-btn';
  back.title = '前のステージへ戻す';
  back.textContent = '‹';
  back.disabled = idx <= 0 || !shiireCol;
  back.addEventListener('click', () => saveCase(c.id, fieldsFor(c, { stage: STAGES[idx - 1] })));
  actions.appendChild(back);

  const fwd = document.createElement('button');
  fwd.type = 'button';
  fwd.className = 'icon-btn';
  fwd.title = '次のステージへ進める';
  fwd.textContent = '›';
  fwd.disabled = idx >= STAGES.length - 1 || !shiireCol;
  fwd.addEventListener('click', () => saveCase(c.id, fieldsFor(c, { stage: STAGES[idx + 1] })));
  actions.appendChild(fwd);

  const edit = document.createElement('button');
  edit.type = 'button';
  edit.className = 'icon-btn edit';
  edit.title = '編集';
  edit.textContent = '✎';
  edit.disabled = !shiireCol;
  edit.addEventListener('click', () => openCaseModal(c));
  actions.appendChild(edit);

  card.appendChild(actions);
  return card;
}

function fieldsFor(c, overrides) {
  return Object.assign({
    person: c.person, name: c.name, stage: c.stage,
    mokusen: c.mokusen, price: c.price, area: c.area,
    checked: c.checked, dropped: c.dropped,
    contractDate: c.contractDate, settlementDate: c.settlementDate,
  }, overrides);
}

function renderStats() {
  const recs = visibleCases();
  document.getElementById('stat-count').textContent = recs.length.toLocaleString('ja-JP');
  const total = recs.reduce((s, c) => s + (c.price || 0), 0);
  document.getElementById('stat-amount').textContent = total.toLocaleString('ja-JP');
  const dueSoon = recs.filter((c) => c.stage === '決済' && getSettlementAlert(c.settlementDate).level !== 'normal').length;
  document.getElementById('stat-due-soon').textContent = dueSoon.toLocaleString('ja-JP');
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
}

// ===== モーダル：追加・編集 =====

const modalOverlay = document.getElementById('case-modal-overlay');

function openCaseModal(record) {
  editingId = record ? record.id : null;
  document.getElementById('case-modal-title').textContent = record ? '案件を編集' : '案件を追加';
  renderPersonSelect();
  const personSelect = document.getElementById('field-person');
  const personNew = document.getElementById('field-person-new');
  const person = record ? record.person : (activePerson !== '全員' ? activePerson : '');
  if (person && [...personSelect.options].some((o) => o.value === person)) {
    personSelect.value = person;
    personNew.hidden = true;
    personNew.value = '';
  } else {
    personSelect.value = '__new__';
    personNew.hidden = false;
    personNew.value = person;
  }
  document.getElementById('field-stage').value = record ? record.stage : '見当初期';
  document.getElementById('field-name').value = record ? record.name : '';
  document.getElementById('field-mokusen').value = record && record.mokusen != null ? record.mokusen : '';
  document.getElementById('field-price').value = record && record.price != null ? record.price : '';
  document.getElementById('field-area').value = record ? record.area : '';
  document.getElementById('field-checked').checked = record ? !!record.checked : false;
  document.getElementById('field-contract-date').value = record ? record.contractDate : '';
  document.getElementById('field-settlement-date').value = record ? record.settlementDate : '';
  document.getElementById('field-dropped').checked = record ? !!record.dropped : false;
  document.getElementById('case-modal-delete').hidden = !record;
  modalOverlay.hidden = false;
}

function closeCaseModal() {
  modalOverlay.hidden = true;
}

document.getElementById('field-person').addEventListener('change', (e) => {
  const personNew = document.getElementById('field-person-new');
  personNew.hidden = e.target.value !== '__new__';
  if (!personNew.hidden) personNew.focus();
});

document.getElementById('add-case-btn').addEventListener('click', () => {
  if (!shiireCol) return;
  openCaseModal(null);
});
document.getElementById('case-modal-close').addEventListener('click', closeCaseModal);
document.getElementById('case-modal-cancel').addEventListener('click', closeCaseModal);
modalOverlay.addEventListener('click', (e) => { if (e.target === modalOverlay) closeCaseModal(); });

document.getElementById('case-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const mokusenVal = document.getElementById('field-mokusen').value;
  const priceVal = document.getElementById('field-price').value;
  const personSelect = document.getElementById('field-person');
  const personValue = personSelect.value === '__new__'
    ? document.getElementById('field-person-new').value.trim()
    : personSelect.value;
  const fields = {
    person: personValue || '未設定',
    stage: document.getElementById('field-stage').value,
    name: document.getElementById('field-name').value.trim() || '(物件名未入力)',
    mokusen: mokusenVal === '' ? null : Number(mokusenVal),
    price: priceVal === '' ? null : Number(priceVal),
    area: document.getElementById('field-area').value.trim(),
    checked: document.getElementById('field-checked').checked,
    contractDate: document.getElementById('field-contract-date').value,
    settlementDate: document.getElementById('field-settlement-date').value,
    dropped: document.getElementById('field-dropped').checked,
  };
  const id = editingId || db.collection('shiireCases').doc().id;
  saveCase(id, fields).then(closeCaseModal);
});

document.getElementById('case-modal-delete').addEventListener('click', () => {
  if (!editingId) return;
  if (!confirm('この案件を削除します。元に戻せません。よろしいですか？')) return;
  deleteCase(editingId).then(closeCaseModal);
});

document.getElementById('show-dropped').addEventListener('change', (e) => {
  showDropped = e.target.checked;
  render();
});

initShiire();
