import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { bomCSV, bomStructureCSV } from '../src/bom-csv.js';
import { i18n } from '../src/i18n/index.js';
import { chartTypeLabels, qualityTypeLabels, productionStatusLabels } from '../src/i18n/production-display.js';
import { aggregateQualityChart } from '../shared/quality-charts.js';

test('production catalog provides complete Chinese, English and Vietnamese workflows', async () => {
  const { default: catalog } = await import('../src/i18n/catalogs/production.js');
  for (const label of ['生产登记', '确认作废', '品质管理', '保存草稿', '选择下级配方（必填）', '实际耗料']) {
    const entry = Object.values(catalog).find(values => values[0] === label);
    assert.ok(entry, `Missing workflow label: ${label}`);
    assert.equal(entry.length, 3);
    assert.ok(entry.every(text => typeof text === 'string' && text.trim()));
    assert.notEqual(entry[0], entry[1]);
    assert.notEqual(entry[0], entry[2]);
  }
  for (const [key, values] of Object.entries(catalog)) {
    assert.match(key, /^production\.[a-zA-Z]/);
    const params = value => [...value.matchAll(/\{\{([^}]+)\}\}/g)].map(match => match[1]).sort();
    assert.deepEqual(params(values[1]), params(values[0]), `${key} English interpolation`);
    assert.deepEqual(params(values[2]), params(values[0]), `${key} Vietnamese interpolation`);
  }
});

test('BOM exports honor an explicit output language without translating material data', () => {
  const snapshot = { name: '用户配方', warehouse: {name:'用户仓库'}, product: {name:'用户成品',barcode:'P1',unit:'件'}, rows:[], nodes:[], production_quantity:2, base_quantity:1, captured_at:'2026-10-25T00:00:00Z', version:1, bom_id:1 };
  assert.match(bomCSV(snapshot,'zh-CN'), /生产数量/);
  assert.match(bomCSV(snapshot,'en'), /Production quantity/);
  assert.match(bomStructureCSV(snapshot,'vi'), /Đường dẫn/);
  assert.match(bomCSV(snapshot,'en'), /用户配方/);
  assert.match(bomCSV(snapshot,'vi'), /用户成品/);
});

test('shared production display maps react to language changes while business identifiers stay stable', async () => {
  const previous = i18n.language;
  try {
    await i18n.changeLanguage('zh-CN');
    assert.equal(chartTypeLabels.line, '折线图');
    await i18n.changeLanguage('en');
    assert.equal(chartTypeLabels.line, 'Line chart');
    assert.equal(qualityTypeLabels.uniqueKey, 'Unique KEY');
    assert.equal(productionStatusLabels.awaiting_materials, 'Awaiting materials');
    await i18n.changeLanguage('vi');
    assert.equal(chartTypeLabels.line, 'Biểu đồ đường');
    assert.equal(productionStatusLabels.awaiting_materials, 'Chờ cấp nguyên liệu');
    assert.deepEqual(Object.keys(productionStatusLabels), ['draft','awaiting_materials','in_progress','completed','void']);
    // Explicit exports do not follow or alter the currently selected UI language.
    const snapshot = {name:'配方',warehouse:{name:'仓库'},product:{name:'成品',barcode:'P1',unit:'件'},rows:[],production_quantity:1,base_quantity:1};
    assert.match(bomCSV(snapshot, 'en'), /Production quantity/);
    assert.equal(i18n.language, 'vi');
  } finally { await i18n.changeLanguage(previous); }
});

test('quality chart metadata distinguishes generated series labels from identical user data', () => {
  const definition={sheetName:'Data',fields:[{id:'category',name:'分类',type:'string'},{id:'group',name:'组',type:'string'}]};
  const config={kind:'ordinary',objectId:null,x:{fieldId:'category'},groupBy:null,metric:{aggregation:'count'}};
  const entry=value=>({id:1,definition,result:{sheets:[{sheetName:'Data',results:[{id:'category',value:'A'},{id:'group',value}],issues:[]}]}});
  const generated=aggregateQualityChart(config,definition,[entry('统计值')]).rows[0];
  assert.equal(generated.series, '统计值');
  assert.equal(generated.seriesLabelKey, 'statistic');
  const user=aggregateQualityChart({...config,groupBy:{fieldId:'group'}},definition,[entry('统计值')]).rows[0];
  assert.equal(user.seriesLabel, '统计值');
  assert.equal(user.seriesLabelKey, undefined);
  const blank=aggregateQualityChart({...config,groupBy:{fieldId:'group'}},definition,[entry('')]).rows[0];
  assert.equal(blank.seriesLabelKey, 'empty');
  const unbound=aggregateQualityChart({...config,groupBy:{system:'material'}},definition,[entry('')]).rows[0];
  assert.equal(unbound.seriesLabelKey, 'unboundMaterial');
});

test('production pages subscribe to locale without remounting or changing editable template data', () => {
  const files = ['src/pages/Production.jsx','src/pages/Bom.jsx','src/pages/Quality.jsx','src/pages/QualityOnlineEditor.jsx','src/pages/QualityTemplateDesigner.jsx','src/features/ProductionStages.jsx'];
  for(const file of files) {
    const source = fs.readFileSync(new URL('../'+file, import.meta.url),'utf8');
    assert.match(source,/useLocale\(\)/,file);
    assert.doesNotMatch(source,/key=\{locale\}/,file);
  }
  const editor = fs.readFileSync(new URL('../src/pages/QualityChecksEditor.jsx', import.meta.url),'utf8');
  assert.match(editor,/passValues:\s*\['OK',\s*'合格',\s*'OK是'\]/);
});
