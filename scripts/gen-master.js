// JPX上場銘柄一覧(data_j.xls)から銘柄マスタJSONを生成
const XLSX = require('xlsx');
const fs = require('fs');

const toHalfWidth = (s) =>
  s
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/－/g, '-');

const MARKETS = {
  'プライム（内国株式）': 'P',
  'スタンダード（内国株式）': 'S',
  'グロース（内国株式）': 'G',
};

const wb = XLSX.readFile(process.argv[2] || 'data_j.xls');
const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]]);
const stocks = rows
  .filter((r) => MARKETS[r['市場・商品区分']])
  .map((r) => ({
    c: String(r['コード']),
    n: toHalfWidth(String(r['銘柄名'])),
    m: MARKETS[r['市場・商品区分']],
  }))
  .sort((a, b) => a.c.localeCompare(b.c));

const out = {
  version: String(rows[0]['日付']),
  source: 'JPX 東証上場銘柄一覧',
  stocks,
};
fs.writeFileSync(process.argv[3] || 'master.json', JSON.stringify(out));
console.log(`stocks: ${stocks.length}, version: ${out.version}`);
