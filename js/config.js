// ============================================================
//  買取再販 物件販売管理アプリ - 設定ファイル
//  このファイルを編集してFirebaseプロジェクトの情報を設定してください
// ============================================================

// ===== Firebase 設定 =====
// 1. Firebase Console (https://console.firebase.google.com) でプロジェクトを作成
// 2. 「プロジェクトの設定」→「マイアプリ」でWebアプリを追加
// 3. 表示されるconfigオブジェクトの値を以下にコピーしてください
const FIREBASE_CONFIG = {
  apiKey:            "YOUR_API_KEY",
  authDomain:        "YOUR_PROJECT.firebaseapp.com",
  projectId:         "YOUR_PROJECT",
  storageBucket:     "YOUR_PROJECT.firebasestorage.app",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:             "YOUR_APP_ID"
};

// ===== 決済日アラートの閾値（日数） =====
// 決済日までの残り日数がこの値以下ならゴールド表示（0=当日、マイナス=期限超過は別扱い）
const SETTLEMENT_ALERT_DAYS = 7;

// ===== ブランドカラー（いえプロ不動産） =====
// css/style.css 側の CSS変数と対応。JS側では主にグラフ描画で使用する
const BRAND_COLORS = {
  navy:    '#2C4A5E',
  navySub: '#3D5268',
  gold:    '#D9922E',
  danger:  '#C0503F',
};

// ============================================================
//  以下は変更不要
// ============================================================

// Firebase 初期化
if (typeof firebase !== 'undefined' && !firebase.apps.length) {
  firebase.initializeApp(FIREBASE_CONFIG);
}

const db = typeof firebase !== 'undefined' ? firebase.firestore() : null;

// ===== 日付ユーティリティ =====

function getTodayString() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseDateOnly(dateStr) {
  // 'YYYY-MM-DD' を時刻0時のDateにする（タイムゾーンによるズレを避けるため年月日で組み立てる）
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  if (!y || !m || !d) return null;
  return new Date(y, m - 1, d);
}

function formatDateJP(dateStr) {
  const date = parseDateOnly(dateStr);
  if (!date) return '未設定';
  const days = ['日', '月', '火', '水', '木', '金', '土'];
  return `${date.getFullYear()}/${date.getMonth() + 1}/${date.getDate()}(${days[date.getDay()]})`;
}

// 決済日の残り日数からアラートレベルを判定する
// level: 'overdue'（過去）/ 'warning'（残りSETTLEMENT_ALERT_DAYS日以内）/ 'normal'
function getSettlementAlert(settlementDate) {
  const target = parseDateOnly(settlementDate);
  if (!target) return { level: 'normal', label: '', diffDays: null };
  const today = parseDateOnly(getTodayString());
  const diffDays = Math.round((target - today) / 86400000);
  if (diffDays < 0) return { level: 'overdue', label: '期限超過', diffDays };
  if (diffDays <= SETTLEMENT_ALERT_DAYS) return { level: 'warning', label: `残り${diffDays}日`, diffDays };
  return { level: 'normal', label: '', diffDays };
}

// ===== 金額表示 =====

function formatMan(value) {
  const num = Number(value);
  if (isNaN(num)) return '－';
  return num.toLocaleString('ja-JP') + '万円';
}

function formatManSigned(value) {
  const num = Number(value);
  if (isNaN(num) || num === 0) return '±0万円';
  const sign = num > 0 ? '+' : '';
  return sign + num.toLocaleString('ja-JP') + '万円';
}

// ===== 価格変更履歴 =====

// history配列を日付昇順に並べ、前回との差分（diff）を付与して返す
function computeHistoryWithDiff(history) {
  const sorted = (history || []).slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return sorted.map((entry, i) => {
    const prev = i > 0 ? sorted[i - 1] : null;
    return {
      date: entry.date,
      price: entry.price,
      diff: prev ? entry.price - prev.price : null,
    };
  });
}

// ===== トースト通知 =====

function showToast(message) {
  let toast = document.getElementById('app-toast');
  if (!toast) {
    toast = document.createElement('div');
    toast.id = 'app-toast';
    toast.className = 'toast';
    document.body.appendChild(toast);
  }
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toast._hideTimer);
  toast._hideTimer = setTimeout(() => toast.classList.remove('show'), 2500);
}
