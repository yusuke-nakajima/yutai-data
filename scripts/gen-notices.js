// 配当予想額(div)の変更・優待制度の変更/新設/廃止を検知し、お知らせデータ(notices.json)を更新する。
// 配当は前回実行時点のスナップショット(notices-div-snapshot.json)と現在のyutai.jsonを比較することで、
// 「前回この処理を実行してから変わった配当」を検知する(1日1回の実行を想定)。
// 優待の変更/新設/廃止は、直近24時間でクローズされたyutai-updateラベルIssueから判定する
// (yutai側のX投稿ロジック(scripts/x-post/content.js)と同じ考え方)。
// announcements(アプリ更新等のお知らせ)はここでは扱わない。手動でnotices.jsonに追記・削除する運用。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const YUTAI_PATH = path.join(ROOT, 'yutai.json');
const NOTICES_PATH = path.join(ROOT, 'notices.json');
const SNAPSHOT_PATH = path.join(ROOT, 'notices-div-snapshot.json');
const RETENTION_DAYS = 7;
const REPO = 'yusuke-nakajima/yutai-data';

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

// 直近24hでクローズした yutai-update ラベルのIssueを全件取得(認証不要、公開リポジトリの読み取りのみ)
async function fetchRecentClosedChanges() {
  const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const url = `https://api.github.com/repos/${REPO}/issues?state=closed&labels=yutai-update&since=${since}&sort=updated&direction=desc&per_page=100`;
  const res = await fetch(url, { headers: { Accept: 'application/vnd.github+json' } });
  if (!res.ok) return [];
  const issues = await res.json();
  return issues.filter((i) => i.closed_at && new Date(i.closed_at) >= new Date(since));
}

// タイトル例: "[優待開示] 8163 ＳＲＳＨＤ: 株主優待制度の変更(拡充)に関するお知らせ"
function extractIssueCode(issue) {
  const m = issue.title.match(/^\[優待開示\]\s*(\S+)\s+/);
  return m ? m[1] : null;
}

function extractIssueName(issue) {
  const m = issue.title.match(/^\[優待開示\]\s*\S+\s+(\S+):/);
  return m ? m[1] : null;
}

// 「新設」「導入」を含むタイトルのみ新設扱い、それ以外(変更/拡充/一部変更/廃止等)は変更として扱う
function isNewIssueTitle(issue) {
  return /新設|導入/.test(issue.title);
}

function isDiscontinuedIssueTitle(issue) {
  return /廃止/.test(issue.title);
}

function truncate(text, max) {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function main() {
  const yutai = readJson(YUTAI_PATH, { items: [] });
  const items = yutai.items ?? [];
  const itemsByCode = new Map(items.map((i) => [i.code, i]));
  const prevSnapshot = readJson(SNAPSHOT_PATH, {}); // { [code]: div }
  const notices = readJson(NOTICES_PATH, { dividend: [], announcements: [], yutaiChanges: [] });
  notices.dividend = notices.dividend ?? [];
  notices.announcements = notices.announcements ?? [];
  notices.yutaiChanges = notices.yutaiChanges ?? [];

  const today = todayKey();
  const existingDivIds = new Set(notices.dividend.map((d) => d.id));

  let addedDiv = 0;
  for (const item of items) {
    if (item.div === undefined) continue;
    const prevDiv = prevSnapshot[item.code];
    // 前回スナップショットに値があり、かつ変化していた場合のみ「配当お知らせ」にする
    // (新規収録で初めてdivが付いた場合は変更ではないので対象外)
    if (prevDiv !== undefined && prevDiv !== item.div) {
      const id = `div-${today}-${item.code}`;
      if (!existingDivIds.has(id)) {
        notices.dividend.push({
          id,
          date: today,
          code: item.code,
          name: item.name,
          prevDiv,
          newDiv: item.div,
        });
        existingDivIds.add(id);
        addedDiv++;
      }
    }
  }

  return fetchRecentClosedChanges().then((changeIssues) => {
    const existingYutaiIds = new Set(notices.yutaiChanges.map((c) => c.id));
    let addedYutai = 0;
    const seenCodes = new Set();
    for (const issue of changeIssues) {
      const code = extractIssueCode(issue);
      if (!code || seenCodes.has(code)) continue;
      const id = `yutai-${today}-${code}`;
      if (existingYutaiIds.has(id)) continue;

      const item = itemsByCode.get(code);
      const discontinued = isDiscontinuedIssueTitle(issue) && !item;
      const kind = discontinued ? 'discontinued' : isNewIssueTitle(issue) ? 'new' : 'change';
      // 廃止の場合yutai.jsonに現存データが無いため、Issueタイトルから社名を復元する
      const name = item ? item.name : extractIssueName(issue) || code;
      if (!item && !discontinued) continue; // 変更/新設なのにyutai.json未収録(全容不明のためスキップされたIssue)は対象外

      notices.yutaiChanges.push({
        id,
        date: today,
        code,
        name,
        kind,
        summary: item ? truncate(item.benefit, 60) : undefined,
      });
      existingYutaiIds.add(id);
      seenCodes.add(code);
      addedYutai++;
    }

    // 7日より古いお知らせは間引く(お知らせページの上書き運用。announcementsは対象外)
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
    const cutoffKey = cutoff.toISOString().slice(0, 10);
    const beforeDiv = notices.dividend.length;
    notices.dividend = notices.dividend.filter((d) => d.date >= cutoffKey);
    const prunedDiv = beforeDiv - notices.dividend.length;
    const beforeYutai = notices.yutaiChanges.length;
    notices.yutaiChanges = notices.yutaiChanges.filter((c) => c.date >= cutoffKey);
    const prunedYutai = beforeYutai - notices.yutaiChanges.length;

    // 次回比較用に現在の配当額を全銘柄分保存
    const nextSnapshot = {};
    for (const item of items) {
      if (item.div !== undefined) nextSnapshot[item.code] = item.div;
    }

    fs.writeFileSync(NOTICES_PATH, JSON.stringify(notices, null, 2) + '\n');
    fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(nextSnapshot, null, 2) + '\n');

    console.log(
      `配当お知らせ追加: ${addedDiv}件 / 間引き: ${prunedDiv}件 / 保持中: ${notices.dividend.length}件`
    );
    console.log(
      `優待変更お知らせ追加: ${addedYutai}件 / 間引き: ${prunedYutai}件 / 保持中: ${notices.yutaiChanges.length}件`
    );
  });
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
