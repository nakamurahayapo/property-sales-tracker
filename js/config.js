// ============================================================
//  買取再販 物件販売管理アプリ - 設定ファイル
//  このファイルを編集してFirebaseプロジェクトの情報を設定してください
// ============================================================

// ===== Firebase 設定 =====
// 1. Firebase Console (https://console.firebase.google.com) でプロジェクトを作成
// 2. 「プロジェクトの設定」→「マイアプリ」でWebアプリを追加
// 3. 表示されるconfigオブジェクトの値を以下にコピーしてください
const FIREBASE_CONFIG = {
  apiKey:            "AIzaSyAGuif4BFu5YbwHLzeUYK7A4DZVpo_5CLE",
  authDomain:        "kaitorisukezyu-ru.firebaseapp.com",
  projectId:         "kaitorisukezyu-ru",
  storageBucket:     "kaitorisukezyu-ru.firebasestorage.app",
  messagingSenderId: "860324051540",
  appId:             "1:860324051540:web:9c9ec839c05f0bb83b4bc1"
};

// ===== 仕入決済予定日アラートの閾値（日数） =====
// 仕入決済予定日までの残り日数がこの値以下ならゴールド表示（0=当日、マイナス=期限超過は別扱い）
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

// 仕入決済予定日の残り日数からアラートレベルを判定する
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

// ===== 値下げ検討アラート =====
// 仕入決済予定日を過ぎてもなお登録されたまま（＝未成約）の物件について、
// 仕入決済予定日から1ヶ月半（1ヶ月＋15日）経過したら「値下げ検討」を促す
const PRICE_REVIEW_MONTHS_AFTER_SETTLEMENT = 1;
const PRICE_REVIEW_DAYS_AFTER_SETTLEMENT = 15;

// 値下げ検討予定日（仕入決済予定日から1ヶ月半後）をDateで返す。仕入決済予定日未設定ならnull
function getPriceReviewDate(settlementDate) {
  const target = parseDateOnly(settlementDate);
  if (!target) return null;
  return new Date(target.getFullYear(), target.getMonth() + PRICE_REVIEW_MONTHS_AFTER_SETTLEMENT, target.getDate() + PRICE_REVIEW_DAYS_AFTER_SETTLEMENT);
}

function isPriceReviewDue(settlementDate) {
  const threshold = getPriceReviewDate(settlementDate);
  if (!threshold) return false;
  const today = parseDateOnly(getTodayString());
  return today >= threshold;
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
