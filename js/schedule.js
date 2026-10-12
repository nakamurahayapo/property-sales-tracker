// ============================================================
//  物件工程表（schedule.html?id=物件ID）
//  物件ドキュメント（properties コレクション）の schedule フィールドに工程と承認状態を保存する。
//  流れ：担当が工程を入力 → 承認申請（承認待ち）→ 上長が承認／差戻し。
//  承認済み・承認待ちの工程を修正すると「未申請」に戻り、再申請が必要になる。
//  工程の「完了」チェックだけは進捗記録なので、承認状態を変えずに更新できる。
//  config.js の db / getScheduleAlert / sha256Hex / SCHEDULE_* 設定をそのまま利用する。
// ============================================================

const propertyId = new URLSearchParams(location.search).get('id');

let property = null;       // 最新の物件データ
let isEditing = false;     // 工程の編集モード中か
let editingTasks = [];     // 編集モード中の工程（保存するまでFirestoreに反映しない）
let approvalAction = null; // 'approve' | 'reject'
let layoutReady = false;

document.addEventListener('DOMContentLoaded', function () {
  bindApprovalModal();
  subscribeProperty();
});

// ===== Firestore購読 =====

function subscribeProperty() {
  const root = document.getElementById('schedule-root');
  if (!db || !propertyId) {
    root.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">⚠️</div>物件が指定されていません。物件一覧の物件名から開いてください</div></div>';
    return;
  }
  db.collection('properties').doc(propertyId).onSnapshot(function (doc) {
    if (!doc.exists) {
      property = null;
      layoutReady = false;
      root.innerHTML = '<div class="card"><div class="empty-state"><div class="empty-icon">🏠</div>この物件は削除されたか、見つかりません</div></div>';
      return;
    }
    property = Object.assign({ id: doc.id }, doc.data());
    render();
  }, function (err) {
    console.error('物件取得エラー:', err);
    showToast('データの取得に失敗しました');
  });
}

function getSchedule() {
  const s = (property && property.schedule) || {};
  return {
    tasks: Array.isArray(s.tasks) ? s.tasks : [],
    status: SCHEDULE_STATUS_LABELS[s.status] ? s.status : 'draft',
    submittedBy: s.submittedBy || '',
    submittedAt: s.submittedAt || '',
    approvedBy: s.approvedBy || '',
    approvedAt: s.approvedAt || '',
    rejectedBy: s.rejectedBy || '',
    rejectedAt: s.rejectedAt || '',
    rejectComment: s.rejectComment || '',
    log: Array.isArray(s.log) ? s.log : [],
  };
}

function saveSchedule(next, message) {
  return db.collection('properties').doc(propertyId).update({
    schedule: next,
    updatedAt: firebase.firestore.FieldValue.serverTimestamp(),
  }).then(function () {
    if (message) showToast(message);
    return true;
  }).catch(function (err) {
    console.error('工程表保存エラー:', err);
    showToast('保存に失敗しました');
    return false;
  });
}

// ===== 描画 =====

function render() {
  const root = document.getElementById('schedule-root');
  if (!layoutReady) {
    root.innerHTML = `
      <div class="card"><div class="card-body" id="sec-property"></div></div>
      <div class="card" id="sec-approval"></div>
      <div class="card">
        <div class="card-header schedule-card-header">
          <span>工程表</span>
          <div class="schedule-card-actions" id="schedule-actions"></div>
        </div>
        <div class="card-body" id="sec-schedule"></div>
      </div>
      <div class="card">
        <div class="card-header">申請・承認の履歴</div>
        <div class="card-body" id="sec-log"></div>
      </div>`;
    bindScheduleSection();
    layoutReady = true;
  }
  document.title = `${property.name || '物件'} の工程表`;
  renderPropertyInfo();
  renderApproval();
  renderLog();
  // 編集中はユーザーの入力を消さないよう、工程エディタは描き直さない
  if (!isEditing) renderScheduleView();
}

function renderPropertyInfo() {
  const lots = Array.isArray(property.lots) && property.lots.length ? property.lots : [{ lotName: '', staff: property.staff || '' }];
  const staffNames = Array.from(new Set(lots.map(function (l) { return l.staff; }).filter(Boolean)));
  const mapLink = property.address
    ? ` <a href="${escapeHtml(getGoogleMapsUrl(property.address))}" target="_blank" rel="noopener" class="map-link">📍${escapeHtml(property.address)}</a>`
    : '';
  const lotNames = lots.map(function (l) { return l.lotName; }).filter(Boolean);
  document.getElementById('sec-property').innerHTML = `
    <div class="schedule-property-name">${escapeHtml(property.name || '(物件名なし)')}</div>
    <div class="schedule-property-meta">
      ${mapLink ? `<span>${mapLink}</span>` : ''}
      <span>担当：<b>${escapeHtml(staffNames.join('、') || '未設定')}</b></span>
      ${lotNames.length ? `<span>区画：${escapeHtml(lotNames.join('、'))}</span>` : ''}
    </div>`;
}

function renderApproval() {
  const s = getSchedule();
  const wrap = document.getElementById('sec-approval');
  const hasTasks = s.tasks.length > 0;
  let body = '';

  if (!hasTasks) {
    body = `<div class="approval-message approval-message-danger">⚠ 工程が入力されていません。「工程を編集」から工程を登録し、上長に承認申請してください。</div>`;
  } else if (s.status === 'draft' || s.status === 'rejected') {
    if (s.status === 'rejected') {
      body += `<div class="approval-message approval-message-danger">
        差戻し（${escapeHtml(s.rejectedBy)}・${escapeHtml(s.rejectedAt)}）${s.rejectComment ? `<div class="approval-comment">「${escapeHtml(s.rejectComment)}」</div>` : ''}
        <div class="form-hint">内容を修正して再度申請してください。</div>
      </div>`;
    } else {
      body += `<div class="approval-message">工程を入力したら、上長に承認申請してください。</div>`;
    }
    body += `<div class="approval-submit-row">
      <input type="text" id="submit-applicant" list="applicant-options" placeholder="申請者（担当）名" value="${escapeHtml(defaultApplicant())}">
      <datalist id="applicant-options">${staffOptions().map(function (n) { return `<option value="${escapeHtml(n)}">`; }).join('')}</datalist>
      <button type="button" class="btn btn-accent" id="submit-approval-btn">上長に承認申請する</button>
    </div>`;
  } else if (s.status === 'pending') {
    body = `<div class="approval-message approval-message-warning">
      ${escapeHtml(s.submittedBy)} さんが ${escapeHtml(s.submittedAt)} に承認申請しました。上長の承認待ちです。
    </div>
    <div class="approval-submit-row">
      <button type="button" class="btn btn-accent" id="approve-btn">承認する（上長）</button>
      <button type="button" class="btn btn-danger" id="reject-btn">差戻す（上長）</button>
    </div>`;
  } else if (s.status === 'approved') {
    body = `<div class="approval-message approval-message-ok">
      ✔ ${escapeHtml(s.approvedBy)} さんが ${escapeHtml(s.approvedAt)} に承認しました（申請：${escapeHtml(s.submittedBy)}）
      <div class="form-hint">工程を修正すると承認が取り消され、再申請が必要になります（完了チェックは承認のままで更新できます）。</div>
    </div>`;
  }

  const badgeLevel = hasTasks ? s.status : 'missing';
  const badgeLabel = hasTasks ? SCHEDULE_STATUS_LABELS[s.status] : '工程未入力';
  wrap.innerHTML = `
    <div class="card-header schedule-card-header">
      <span>承認状況</span>
      <span class="approval-badge approval-badge-${badgeLevel}">${badgeLabel}</span>
    </div>
    <div class="card-body">${body}</div>`;

  const submitBtn = document.getElementById('submit-approval-btn');
  if (submitBtn) submitBtn.addEventListener('click', submitForApproval);
  const approveBtn = document.getElementById('approve-btn');
  if (approveBtn) approveBtn.addEventListener('click', function () { openApprovalModal('approve'); });
  const rejectBtn = document.getElementById('reject-btn');
  if (rejectBtn) rejectBtn.addEventListener('click', function () { openApprovalModal('reject'); });
}

function staffOptions() {
  return Array.from(new Set((property.lots || []).map(function (l) { return l.staff; }).filter(Boolean)));
}

function defaultApplicant() {
  const s = getSchedule();
  return s.submittedBy || staffOptions()[0] || '';
}

const LOG_ACTION_LABELS = {
  submit: '承認申請',
  approve: '承認',
  reject: '差戻し',
  edit: '工程を修正（承認取消）',
};

function renderLog() {
  const log = getSchedule().log.slice().reverse();
  const wrap = document.getElementById('sec-log');
  if (!log.length) {
    wrap.innerHTML = '<div class="form-hint">まだ履歴はありません</div>';
    return;
  }
  wrap.innerHTML = `<table class="history-table schedule-log-table">
    <thead><tr><th>日時</th><th>内容</th><th>実施者</th><th>コメント</th></tr></thead>
    <tbody>${log.map(function (l) {
      return `<tr>
        <td>${escapeHtml(l.at)}</td>
        <td>${escapeHtml(LOG_ACTION_LABELS[l.action] || l.action)}</td>
        <td>${escapeHtml(l.by || '－')}</td>
        <td>${escapeHtml(l.comment || '')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

// ===== 工程表（閲覧：ガントチャート＋一覧） =====

function taskLabel(t) {
  if (t.type && t.type !== 'その他') return t.name ? `${t.type}（${t.name}）` : t.type;
  return t.name || t.type || '(工程名なし)';
}

function sortTasks(tasks) {
  return tasks.slice().sort(function (a, b) {
    const as = a.startDate || a.endDate || '9999';
    const bs = b.startDate || b.endDate || '9999';
    return as < bs ? -1 : as > bs ? 1 : 0;
  });
}

function isTaskDelayed(t) {
  return !t.done && t.endDate && t.endDate < getTodayString();
}

function renderScheduleView() {
  const tasks = sortTasks(getSchedule().tasks);
  document.getElementById('schedule-actions').innerHTML =
    '<button type="button" class="btn btn-secondary btn-sm" id="edit-schedule-btn">工程を編集</button>';
  const wrap = document.getElementById('sec-schedule');
  if (!tasks.length) {
    wrap.innerHTML = `<div class="empty-state"><div class="empty-icon">🗓</div>工程が入力されていません<br>
      <span class="form-hint">解体・測量・電柱移設・造成などの予定を登録してください</span></div>`;
    return;
  }
  wrap.innerHTML = renderGantt(tasks) + `
    <div class="table-scroll schedule-table-scroll">
      <table class="property-table schedule-table">
        <thead><tr>
          <th class="no-sort">完了</th><th class="no-sort">工程</th><th class="no-sort">業者</th>
          <th class="no-sort">開始予定</th><th class="no-sort">終了予定</th><th class="no-sort">状態</th><th class="no-sort">備考</th>
        </tr></thead>
        <tbody>${tasks.map(function (t) {
          const delayed = isTaskDelayed(t);
          const state = t.done
            ? '<span class="tag tag-sold">完了</span>'
            : delayed ? '<span class="tag tag-overdue">遅延</span>' : '';
          return `<tr class="${t.done ? 'row-sold' : delayed ? 'row-overdue' : ''}">
            <td><input type="checkbox" class="task-done-toggle" data-task-id="${escapeHtml(t.id)}" ${t.done ? 'checked' : ''} title="完了にする"></td>
            <td class="property-name-cell">${escapeHtml(taskLabel(t))}</td>
            <td>${escapeHtml(t.vendor || '－')}</td>
            <td>${t.startDate ? formatDateJP(t.startDate) : '未定'}</td>
            <td>${t.endDate ? formatDateJP(t.endDate) : '未定'}</td>
            <td>${state}</td>
            <td class="schedule-note-cell">${escapeHtml(t.note || '')}</td>
          </tr>`;
        }).join('')}</tbody>
      </table>
    </div>`;
}

// 工程の期間を横棒で並べたガントチャート（外部ライブラリなし。月単位の目盛り＋今日の線）
function renderGantt(tasks) {
  const dated = tasks.filter(function (t) { return t.startDate || t.endDate; });
  if (!dated.length) return '<div class="form-hint" style="margin-bottom:12px">日程が入力された工程がないため、ガントチャートは表示されません</div>';

  const today = parseDateOnly(getTodayString());
  const times = [];
  dated.forEach(function (t) {
    if (t.startDate) times.push(parseDateOnly(t.startDate).getTime());
    if (t.endDate) times.push(parseDateOnly(t.endDate).getTime());
  });
  const minD = new Date(Math.min.apply(null, times));
  const maxD = new Date(Math.max.apply(null, times));
  // 表示範囲は最初の工程の月初〜最後の工程の月末
  const rangeStart = new Date(minD.getFullYear(), minD.getMonth(), 1);
  const rangeEnd = new Date(maxD.getFullYear(), maxD.getMonth() + 1, 1);
  const span = rangeEnd - rangeStart;
  const pct = function (d) { return ((d - rangeStart) / span) * 100; };

  let months = '';
  for (let m = new Date(rangeStart); m < rangeEnd; m = new Date(m.getFullYear(), m.getMonth() + 1, 1)) {
    const next = new Date(m.getFullYear(), m.getMonth() + 1, 1);
    const label = (m.getMonth() === 0 || m.getTime() === rangeStart.getTime()) ? `${m.getFullYear()}/${m.getMonth() + 1}` : `${m.getMonth() + 1}月`;
    months += `<div class="gantt-month" style="left:${pct(m)}%;width:${pct(next) - pct(m)}%">${label}</div>`;
  }
  const todayLine = today >= rangeStart && today < rangeEnd
    ? `<div class="gantt-today" style="left:${pct(today)}%"></div>`
    : '';

  const rows = dated.map(function (t) {
    const s = parseDateOnly(t.startDate || t.endDate);
    const e = parseDateOnly(t.endDate || t.startDate);
    const endExclusive = new Date(e.getFullYear(), e.getMonth(), e.getDate() + 1);
    const cls = t.done ? 'gantt-bar-done' : isTaskDelayed(t) ? 'gantt-bar-delayed' : '';
    const period = `${formatDateJP(t.startDate)}〜${formatDateJP(t.endDate)}`;
    return `<div class="gantt-row">
      <div class="gantt-label" title="${escapeHtml(taskLabel(t))}">${escapeHtml(taskLabel(t))}</div>
      <div class="gantt-track">
        ${todayLine}
        <div class="gantt-bar ${cls}" style="left:${pct(s)}%;width:${Math.max(pct(endExclusive) - pct(s), 0.8)}%" title="${escapeHtml(period)}"></div>
      </div>
    </div>`;
  }).join('');

  return `<div class="gantt">
    <div class="gantt-row gantt-head">
      <div class="gantt-label"></div>
      <div class="gantt-track">${months}${todayLine}</div>
    </div>
    ${rows}
    <div class="gantt-legend">
      <span><i class="gantt-legend-swatch"></i>予定</span>
      <span><i class="gantt-legend-swatch gantt-bar-delayed"></i>遅延</span>
      <span><i class="gantt-legend-swatch gantt-bar-done"></i>完了</span>
      <span><i class="gantt-legend-today"></i>今日</span>
    </div>
  </div>`;
}

// ===== 工程の編集 =====

function bindScheduleSection() {
  const section = document.getElementById('sec-schedule');
  document.getElementById('schedule-actions').addEventListener('click', function (e) {
    if (e.target.id === 'edit-schedule-btn') startEditing();
  });
  // 閲覧モードの完了チェック（承認状態は変えない）
  section.addEventListener('change', function (e) {
    if (e.target.classList.contains('task-done-toggle')) {
      toggleTaskDone(e.target.getAttribute('data-task-id'), e.target.checked);
      return;
    }
    onEditorFieldChange(e);
  });
  section.addEventListener('input', onEditorFieldChange);
  section.addEventListener('click', function (e) {
    if (e.target.id === 'add-task-btn') {
      editingTasks.push(emptyTask(''));
      renderEditor();
    } else if (e.target.classList.contains('add-preset-btn')) {
      editingTasks.push(emptyTask(e.target.getAttribute('data-type')));
      renderEditor();
    } else if (e.target.classList.contains('task-remove-btn')) {
      editingTasks.splice(Number(e.target.getAttribute('data-index')), 1);
      renderEditor();
    } else if (e.target.id === 'cancel-edit-btn') {
      isEditing = false;
      editingTasks = [];
      renderScheduleView();
    } else if (e.target.id === 'save-schedule-btn') {
      saveEditedTasks();
    }
  });
}

function generateTaskId() {
  return 'task_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function emptyTask(type) {
  return { id: generateTaskId(), type: type || '', name: '', vendor: '', startDate: '', endDate: '', done: false, note: '' };
}

function startEditing() {
  isEditing = true;
  editingTasks = sortTasks(getSchedule().tasks).map(function (t) { return Object.assign(emptyTask(''), t); });
  if (!editingTasks.length) editingTasks.push(emptyTask(''));
  document.getElementById('schedule-actions').innerHTML = '';
  renderEditor();
}

function renderEditor() {
  const wrap = document.getElementById('sec-schedule');
  const s = getSchedule();
  const warn = (s.status === 'approved' || s.status === 'pending') && s.tasks.length
    ? `<div class="approval-message approval-message-warning">現在「${SCHEDULE_STATUS_LABELS[s.status]}」です。保存すると承認が取り消され「未申請」に戻ります（再申請が必要）。</div>`
    : '';
  const presets = SCHEDULE_PROCESS_TYPES.filter(function (t) { return t !== 'その他'; }).map(function (t) {
    return `<button type="button" class="btn btn-secondary btn-sm add-preset-btn" data-type="${escapeHtml(t)}">＋${escapeHtml(t)}</button>`;
  }).join('');

  wrap.innerHTML = `${warn}
    <div class="task-editor-list">${editingTasks.map(function (t, i) {
      const typeOptions = ['<option value="">工程を選択</option>'].concat(SCHEDULE_PROCESS_TYPES.map(function (type) {
        return `<option value="${escapeHtml(type)}" ${t.type === type ? 'selected' : ''}>${escapeHtml(type)}</option>`;
      })).join('');
      return `<div class="task-editor">
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">工程</label>
            <select data-field="type" data-index="${i}">${typeOptions}</select>
          </div>
          <div class="form-group">
            <label class="form-label">内容（「その他」の場合は工程名）</label>
            <input type="text" data-field="name" data-index="${i}" value="${escapeHtml(t.name)}" placeholder="例：建物解体・残置物撤去">
          </div>
        </div>
        <div class="form-row">
          <div class="form-group">
            <label class="form-label">業者</label>
            <input type="text" data-field="vendor" data-index="${i}" value="${escapeHtml(t.vendor)}" placeholder="例：〇〇解体工業">
          </div>
          <div class="form-group">
            <label class="form-label">開始予定日</label>
            <input type="date" data-field="startDate" data-index="${i}" value="${escapeHtml(t.startDate)}">
          </div>
          <div class="form-group">
            <label class="form-label">終了予定日</label>
            <input type="date" data-field="endDate" data-index="${i}" value="${escapeHtml(t.endDate)}">
          </div>
        </div>
        <div class="form-row task-editor-bottom">
          <div class="form-group">
            <label class="form-label">備考</label>
            <input type="text" data-field="note" data-index="${i}" value="${escapeHtml(t.note)}">
          </div>
          <label class="form-checkbox"><input type="checkbox" data-field="done" data-index="${i}" ${t.done ? 'checked' : ''}> 完了</label>
          <button type="button" class="btn btn-danger btn-sm task-remove-btn" data-index="${i}">削除</button>
        </div>
      </div>`;
    }).join('')}</div>
    <div class="task-preset-row">${presets}
      <button type="button" class="btn btn-secondary btn-sm" id="add-task-btn">＋その他の工程</button>
    </div>
    <div class="task-editor-footer">
      <button type="button" class="btn btn-secondary" id="cancel-edit-btn">キャンセル</button>
      <button type="button" class="btn btn-accent" id="save-schedule-btn">工程を保存する</button>
    </div>`;
}

function onEditorFieldChange(e) {
  const field = e.target.getAttribute('data-field');
  const index = Number(e.target.getAttribute('data-index'));
  if (!isEditing || field == null || Number.isNaN(index) || !editingTasks[index]) return;
  editingTasks[index][field] = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
}

function saveEditedTasks() {
  const tasks = editingTasks.map(function (t) {
    return {
      id: t.id,
      type: t.type || '',
      name: (t.name || '').trim(),
      vendor: (t.vendor || '').trim(),
      startDate: t.startDate || '',
      endDate: t.endDate || '',
      done: !!t.done,
      note: (t.note || '').trim(),
    };
  });

  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i];
    if (!t.type && !t.name) { showToast(`${i + 1}件目：工程を選択してください`); return; }
    if (t.type === 'その他' && !t.name) { showToast(`${i + 1}件目：「その他」の場合は内容に工程名を入力してください`); return; }
    if (!t.startDate || !t.endDate) { showToast(`${i + 1}件目（${taskLabel(t)}）：開始予定日と終了予定日を入力してください`); return; }
    if (t.endDate < t.startDate) { showToast(`${i + 1}件目（${taskLabel(t)}）：終了予定日は開始予定日以降にしてください`); return; }
  }

  const s = getSchedule();
  const wasLocked = (s.status === 'approved' || s.status === 'pending') && s.tasks.length > 0;
  // 承認に関係するのは完了チェック以外の内容なので、完了チェックだけの変更なら承認状態を維持する
  const contentChanged = JSON.stringify(stripDone(sortTasks(s.tasks))) !== JSON.stringify(stripDone(sortTasks(tasks)));
  const next = Object.assign({}, s, { tasks: tasks });
  if (wasLocked && contentChanged) {
    if (!confirm(`工程を修正すると「${SCHEDULE_STATUS_LABELS[s.status]}」が取り消され、再度上長の承認が必要になります。保存しますか？`)) return;
    next.status = 'draft';
    next.approvedBy = '';
    next.approvedAt = '';
    next.log = s.log.concat([{ action: 'edit', by: '', at: nowString(), comment: '' }]);
  }
  if (!tasks.length) next.status = 'draft';

  document.getElementById('save-schedule-btn').disabled = true;
  saveSchedule(next, '工程を保存しました').then(function (ok) {
    if (!ok) {
      document.getElementById('save-schedule-btn').disabled = false;
      return;
    }
    isEditing = false;
    editingTasks = [];
    renderScheduleView();
  });
}

function stripDone(tasks) {
  return tasks.map(function (t) {
    return [t.id, t.type || '', t.name || '', t.vendor || '', t.startDate || '', t.endDate || '', t.note || ''];
  });
}

function toggleTaskDone(taskId, done) {
  const s = getSchedule();
  const tasks = s.tasks.map(function (t) { return t.id === taskId ? Object.assign({}, t, { done: done }) : t; });
  saveSchedule(Object.assign({}, s, { tasks: tasks }), done ? '完了にしました' : '未完了に戻しました');
}

// ===== 承認申請（担当） =====

function submitForApproval() {
  const s = getSchedule();
  const applicant = (document.getElementById('submit-applicant').value || '').trim();
  if (!s.tasks.length) { showToast('工程を入力してから申請してください'); return; }
  if (!applicant) { showToast('申請者（担当）名を入力してください'); return; }
  const at = nowString();
  saveSchedule(Object.assign({}, s, {
    status: 'pending',
    submittedBy: applicant,
    submittedAt: at,
    log: s.log.concat([{ action: 'submit', by: applicant, at: at, comment: '' }]),
  }), '上長に承認申請しました');
}

// ===== 承認・差戻し（上長） =====

function bindApprovalModal() {
  document.getElementById('approval-form').addEventListener('submit', onSubmitApproval);
  document.getElementById('approval-modal-close').addEventListener('click', closeApprovalModal);
  document.getElementById('approval-modal-cancel').addEventListener('click', closeApprovalModal);
}

function openApprovalModal(action) {
  approvalAction = action;
  const isReject = action === 'reject';
  document.getElementById('approval-form').reset();
  document.getElementById('approval-modal-title').textContent = isReject ? '工程表を差戻す' : '工程表を承認';
  document.getElementById('approval-modal-submit').textContent = isReject ? '差戻す' : '承認する';
  document.getElementById('approval-modal-submit').className = isReject ? 'btn btn-danger' : 'btn btn-accent';
  document.getElementById('approval-comment-label').textContent = isReject ? 'コメント（差戻し理由・必須）' : 'コメント（任意）';
  document.getElementById('approval-approver').innerHTML = SCHEDULE_APPROVERS.map(function (name) {
    return `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`;
  }).join('');
  document.getElementById('approval-modal-overlay').hidden = false;
  document.getElementById('approval-password').focus();
}

function closeApprovalModal() {
  document.getElementById('approval-modal-overlay').hidden = true;
  approvalAction = null;
}

async function onSubmitApproval(e) {
  e.preventDefault();
  const approver = document.getElementById('approval-approver').value;
  const password = document.getElementById('approval-password').value;
  const comment = document.getElementById('approval-comment').value.trim();
  const s = getSchedule();

  if (s.status !== 'pending') { showToast('承認待ちの工程表ではありません'); closeApprovalModal(); return; }
  if (!approver) { showToast('承認者を選択してください'); return; }
  if (approvalAction === 'reject' && !comment) { showToast('差戻し理由を入力してください'); return; }
  if (approver === s.submittedBy) { showToast('申請者本人は承認・差戻しできません'); return; }
  let hash;
  try {
    hash = await sha256Hex(password);
  } catch (err) {
    console.error('パスワード照合エラー:', err);
    showToast('この環境ではパスワードを照合できません（https または localhost で開いてください）');
    return;
  }
  if (hash !== SCHEDULE_APPROVAL_PASSWORD_HASH) { showToast('承認パスワードが違います'); return; }

  const at = nowString();
  const next = Object.assign({}, s);
  if (approvalAction === 'approve') {
    Object.assign(next, { status: 'approved', approvedBy: approver, approvedAt: at, rejectedBy: '', rejectedAt: '', rejectComment: '' });
  } else {
    Object.assign(next, { status: 'rejected', rejectedBy: approver, rejectedAt: at, rejectComment: comment, approvedBy: '', approvedAt: '' });
  }
  next.log = s.log.concat([{ action: approvalAction, by: approver, at: at, comment: comment }]);
  const message = approvalAction === 'approve' ? '承認しました' : '差戻しました';
  saveSchedule(next, message).then(function (ok) { if (ok) closeApprovalModal(); });
}

// ===== ユーティリティ =====

// 'YYYY/M/D HH:mm'（申請・承認日時の記録用）
function nowString() {
  const d = new Date();
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function escapeHtml(str) {
  return String(str == null ? '' : str).replace(/[&<>"']/g, function (c) {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}
