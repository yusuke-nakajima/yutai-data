// 配当予想額(div)の変更を検知し、お知らせデータ(notices.json)を更新する。
// 前回実行時点の配当スナップショット(notices-div-snapshot.json)と現在のyutai.jsonを比較することで、
// 「前回この処理を実行してから変わった配当」を検知する(1日1回の実行を想定)。
// announcements(アプリ更新等のお知らせ)はここでは扱わない。手動でnotices.jsonに追記・削除する運用。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const YUTAI_PATH = path.join(ROOT, 'yutai.json');
const NOTICES_PATH = path.join(ROOT, 'notices.json');
const SNAPSHOT_PATH = path.join(ROOT, 'notices-div-snapshot.json');
const RETENTION_DAYS = 7;

function readJson(p, fallback) {
  if (!fs.existsSync(p)) return fallback;
  return JSON.parse(fs.readFileSync(p, 'utf8'));
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const yutai = readJson(YUTAI_PATH, { items: [] });
  const items = yutai.items ?? [];
  const prevSnapshot = readJson(SNAPSHOT_PATH, {}); // { [code]: div }
  const notices = readJson(NOTICES_PATH, { dividend: [], announcements: [] });
  notices.dividend = notices.dividend ?? [];
  notices.announcements = notices.announcements ?? [];

  const today = todayKey();
  const existingIds = new Set(notices.dividend.map((d) => d.id));

  let added = 0;
  for (const item of items) {
    if (item.div === undefined) continue;
    const prevDiv = prevSnapshot[item.code];
    // 前回スナップショットに値があり、かつ変化していた場合のみ「配当お知らせ」にする
    // (新規収録で初めてdivが付いた場合は変更ではないので対象外)
    if (prevDiv !== undefined && prevDiv !== item.div) {
      const id = `div-${today}-${item.code}`;
      if (!existingIds.has(id)) {
        notices.dividend.push({
          id,
          date: today,
          code: item.code,
          name: item.name,
          prevDiv,
          newDiv: item.div,
        });
        existingIds.add(id);
        added++;
      }
    }
  }

  // 7日より古い配当お知らせは間引く(お知らせページの上書き運用。announcementsは対象外)
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RETENTION_DAYS);
  const cutoffKey = cutoff.toISOString().slice(0, 10);
  const before = notices.dividend.length;
  notices.dividend = notices.dividend.filter((d) => d.date >= cutoffKey);
  const pruned = before - notices.dividend.length;

  // 次回比較用に現在の配当額を全銘柄分保存
  const nextSnapshot = {};
  for (const item of items) {
    if (item.div !== undefined) nextSnapshot[item.code] = item.div;
  }

  fs.writeFileSync(NOTICES_PATH, JSON.stringify(notices, null, 2) + '\n');
  fs.writeFileSync(SNAPSHOT_PATH, JSON.stringify(nextSnapshot, null, 2) + '\n');

  console.log(`配当お知らせ追加: ${added}件 / 間引き: ${pruned}件 / 保持中: ${notices.dividend.length}件`);
}

main();
