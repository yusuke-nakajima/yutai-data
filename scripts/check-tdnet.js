// TDnet(適時開示情報閲覧サービス)から「株主優待」を含む開示を検知し、GitHub Issueを起票する
// usage: node scripts/check-tdnet.js [YYYYMMDD] [--dry-run]
//   日付省略時は当日(JST)。--dry-run はIssue起票と処理済み記録をせず検知結果を表示するだけ
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const dryRun = process.argv.includes('--dry-run');
const args = process.argv.slice(2).filter((a) => a !== '--dry-run');

function jstToday() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replace(/-/g, '');
}

function jstYesterday() {
  return new Date(Date.now() + 9 * 3600 * 1000 - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10)
    .replace(/-/g, '');
}

// 日付指定なしなら前日+当日をチェック(夕方の定時実行後に出た開示を翌日拾うため)
const dates = args[0] ? [args[0]] : [jstYesterday(), jstToday()];
const BASE = 'https://www.release.tdnet.info/inbs/';
const KEYWORD = '株主優待';
const ROOT = path.join(__dirname, '..');
const SEEN_PATH = path.join(ROOT, 'tdnet-seen.json');

async function fetchDisclosures(date) {
  const rows = [];
  for (let p = 1; p <= 30; p++) {
    const url = `${BASE}I_list_${String(p).padStart(3, '0')}_${date}.html`;
    const res = await fetch(url, { headers: { 'User-Agent': 'yutai-data-bot' } });
    if (!res.ok) break;
    const html = await res.text();
    const found = [
      ...html.matchAll(
        /<td[^>]*kjTime[^>]*>([^<]*)<\/td>\s*<td[^>]*kjCode[^>]*>([^<]*)<\/td>\s*<td[^>]*kjName[^>]*>([^<]*)<\/td>\s*<td[^>]*kjTitle[^>]*><a href="([^"]+)"[^>]*>([^<]*)<\/a>/g
      ),
    ].map((m) => ({
      time: m[1].trim(),
      code: m[2].trim().slice(0, 4), // TDnetは5桁表記(末尾はチェック用)なので先頭4桁が証券コード
      name: m[3].trim(),
      pdf: BASE + m[4].trim(),
      title: m[5].trim(),
    }));
    if (found.length === 0) break;
    rows.push(...found);
    if (found.length < 100) break; // 100件/ページ未満なら最終ページ
  }
  return rows;
}

function loadJson(p, fallback) {
  try {
    return JSON.parse(fs.readFileSync(p, 'utf8'));
  } catch {
    return fallback;
  }
}

// 開示PDFをダウンロードしてテキスト抽出する。
// クラウドルーチン実行環境からTDnetへのegressがブロックされることがあるため、
// ネットワーク制限のないGitHub Actions側で事前にテキスト化してIssue本文に埋め込む。
const MAX_PDF_TEXT = 20000; // GitHub Issue本文の上限(65536文字)に収まるよう抽出テキストを制限
async function fetchPdfText(url) {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': 'yutai-data-bot' } });
    if (!res.ok) return { ok: false, text: '' };
    const buf = Buffer.from(await res.arrayBuffer());
    const pdfParse = require('pdf-parse');
    const data = await pdfParse(buf);
    const text = data.text.trim();
    return { ok: text.length > 0, text: text.slice(0, MAX_PDF_TEXT) };
  } catch (e) {
    return { ok: false, text: '', error: String(e.message || e) };
  }
}

function buildIssue(hit, yutaiItems, yutaiCodes, pdfResult) {
  const item = yutaiItems.find((i) => i.code === hit.code);
  const inCodes = yutaiCodes.includes(hit.code);
  const dateFmt = `${hit.date.slice(0, 4)}-${hit.date.slice(4, 6)}-${hit.date.slice(6, 8)}`;
  const title = `[優待開示] ${hit.code} ${hit.name}: ${hit.title}`;
  const pdfSection = pdfResult.ok
    ? [
        `<details><summary>開示PDF全文(自動抽出テキスト。内容が読み取れればPDFへのアクセスは不要)</summary>`,
        ``,
        '```',
        pdfResult.text,
        '```',
        ``,
        `</details>`,
      ].join('\n')
    : [
        `⚠️ 開示PDFの自動テキスト抽出に失敗しました${pdfResult.error ? `(${pdfResult.error})` : ''}。`,
        `[PDF](${hit.pdf}) を直接確認してください。`,
      ].join('\n');
  const body = [
    `TDnetで株主優待に関する開示を検知しました。`,
    ``,
    `- 開示日時: ${dateFmt} ${hit.time}`,
    `- 会社: ${hit.name} (${hit.code})`,
    `- 表題: ${hit.title}`,
    `- 開示資料: [PDF](${hit.pdf}) ※TDnetの掲載は開示から31日間`,
    ``,
    `### 現在の収録状況`,
    `- yutai-codes.json(優待の有無): ${inCodes ? '✅ 収録あり' : '❌ 未収録'}`,
    `- yutai.json(優待詳細): ${item ? `✅ 収録あり(${item.months.map((m) => m + '月').join('・')} / ${item.benefit})` : '❌ 未収録'}`,
    ``,
    `### 対応チェックリスト`,
    `- [ ] 開示PDF全文(下記)で内容を確認(新設/変更/廃止/条件変更)`,
    `- [ ] 廃止なら yutai-codes.json からコードを削除(詳細収録済みなら yutai.json からも削除)`,
    `- [ ] 新設なら yutai-codes.json にコードを追加`,
    `- [ ] 変更で詳細収録済みなら yutai.json の該当エントリを更新`,
    `- [ ] push後、有無を変えた場合は Actions「Update master.json」を手動実行(またはWed定期実行を待つ)`,
    ``,
    pdfSection,
  ].join('\n');
  return { title, body };
}

async function main() {
  const hits = [];
  for (const d of dates) {
    const all = await fetchDisclosures(d);
    const dayHits = all.filter((r) => r.title.includes(KEYWORD)).map((r) => ({ ...r, date: d }));
    console.log(`${d}: 開示${all.length}件中、株主優待関連${dayHits.length}件`);
    hits.push(...dayHits);
  }

  const seen = loadJson(SEEN_PATH, { ids: [] });
  const seenSet = new Set(seen.ids);
  const newHits = hits.filter((h) => !seenSet.has(h.pdf));
  console.log(`うち未処理: ${newHits.length}件`);

  const yutaiItems = loadJson(path.join(ROOT, 'yutai.json'), { items: [] }).items;
  const yutaiCodes = loadJson(path.join(ROOT, 'yutai-codes.json'), { codes: [] }).codes;

  for (const hit of newHits) {
    const pdfResult = await fetchPdfText(hit.pdf);
    console.log(`${hit.code} ${hit.name}: PDF抽出 ${pdfResult.ok ? `成功(${pdfResult.text.length}文字)` : '失敗'}`);
    const issue = buildIssue(hit, yutaiItems, yutaiCodes, pdfResult);
    if (dryRun) {
      console.log('--- [dry-run] Issue ---');
      console.log(issue.title);
      console.log(issue.body);
      continue;
    }
    const bodyFile = path.join(os.tmpdir(), `tdnet-issue-${Date.now()}.md`);
    fs.writeFileSync(bodyFile, issue.body);
    execFileSync('gh', ['issue', 'create', '--title', issue.title, '--body-file', bodyFile, '--label', 'yutai-update'], {
      stdio: 'inherit',
    });
    fs.unlinkSync(bodyFile);
    seenSet.add(hit.pdf);
  }

  if (!dryRun && newHits.length > 0) {
    // 処理済みIDは直近3000件だけ保持(TDnetの掲載期間31日を大きく超える)
    const ids = [...seenSet].slice(-3000);
    fs.writeFileSync(SEEN_PATH, JSON.stringify({ ids }, null, 0) + '\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
