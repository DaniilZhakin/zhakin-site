const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const registry = require('../assets/js/asset-valuation-registry.js');
function storageMock(){
 const values=new Map();
 return {getItem:key=>values.has(key)?values.get(key):null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key),raw:key=>values.get(key)};
}
const baseInput={name:'Склад «Север»',kind:'property',result:{method:'Сравнительный подход',marketValue:1250000,low:1187500,high:1312500},currency:'RUB',assessmentDate:'2026-11-25'};
test('registry creates a whitelisted summary record without retaining raw inputs or source documents',()=>{
 const record=registry.createRecord({...baseInput,inputs:{owner:'Private',secret:'not stored'},sourceUrl:'https://example.org/private'},{id:'record-1',createdAt:'2026-11-25T10:00:00.000Z'});
 assert.equal(record.id,'record-1');assert.equal(record.value,1250000);assert.equal(record.name,'Склад «Север»');
 assert.equal(Object.hasOwn(record,'inputs'),false);assert.equal(Object.hasOwn(record,'sourceUrl'),false);
});
test('registry persists, lists, removes and clears only its versioned local records',()=>{
 const store=storageMock(),record=registry.createRecord(baseInput,{id:'record-1',createdAt:'2026-11-25T10:00:00.000Z'});
 registry.save(store,record);assert.equal(registry.read(store).length,1);
 registry.remove(store,'record-1');assert.equal(registry.read(store).length,0);
 registry.save(store,record);registry.clear(store);assert.equal(registry.read(store).length,0);
});
test('registry replaces duplicate ids and retains at most 100 latest records',()=>{
 const store=storageMock();
 for(let i=0;i<105;i++){const record=registry.createRecord({...baseInput,name:'Object '+i},{id:'id-'+i,createdAt:new Date(Date.UTC(2026,0,1,0,0,i)).toISOString()});registry.save(store,record);}
 assert.equal(registry.read(store).length,100);assert.equal(registry.read(store)[0].id,'id-104');
 const updated=registry.createRecord({...baseInput,name:'Updated'},{id:'id-104',createdAt:'2026-11-25T12:00:00.000Z'});
 registry.save(store,updated);assert.equal(registry.read(store).length,100);assert.equal(registry.read(store)[0].name,'Updated');
});
test('registry rejects invalid dates, currencies and malformed records; CSV escapes delimiters and quotes',()=>{
 assert.throws(()=>registry.createRecord({...baseInput,assessmentDate:'2026-02-30'}),/корректную дату/);
 assert.throws(()=>registry.createRecord({...baseInput,currency:'XXX'}),/поддерживаемую валюту/);
 const csv=registry.toCsv([registry.createRecord(baseInput,{id:'csv-1',createdAt:'2026-11-25T10:00:00.000Z'})]);
 assert.match(csv,/"Склад «Север»"/);assert.match(csv,/Стоимость/);assert.match(csv,/Сравнительный подход/);
});
test('CSV export neutralizes spreadsheet formulas in user-controlled text and uses CRLF rows',()=>{
 const risky=registry.createRecord({...baseInput,name:'=HYPERLINK("https://example.org","open")',result:{...baseInput.result,method:' +SUM(1,1)'}},{id:'csv-risk-1',createdAt:'2026-11-25T10:00:00.000Z'});
 const csv=registry.toCsv([risky]);
 assert.ok(csv.includes('"\'=HYPERLINK(""https://example.org"",""open"")"'));
 assert.ok(csv.includes('"\'+SUM(1,1)"'));
 assert.ok(csv.includes('\r\n'));
 assert.equal(csv.includes('\\r\\n'),false);
});
test('registry handles unavailable browser storage without silently claiming persistence',()=>{
 const broken={getItem(){throw new Error('blocked');}};
 assert.throws(()=>registry.read(broken),/blocked/);
});
test('valuation page makes local persistence opt-in and exposes history controls',()=>{
 const html=fs.readFileSync(path.join(__dirname,'../centers/asset-valuation/index.html'),'utf8');
 assert.match(html,/id="registry-local-consent" type="checkbox"/);
 assert.match(html,/id="registry-save"[^>]*disabled/);
 assert.match(html,/asset-valuation-registry\.js/);
 assert.match(html,/не отправляются на сервер/);
 assert.match(html,/ZhakinValuationRegistry\.save\(window\.localStorage,record\)/);
});

test('history trend uses the latest saved record per assessment date and keeps assets separate',()=>{
 const records=[
  registry.createRecord({...baseInput,name:'Склад Север',assessmentDate:'2026-11-01'},{id:'trend-1',createdAt:'2026-11-01T10:00:00.000Z'}),
  registry.createRecord({...baseInput,name:'Склад Север',assessmentDate:'2026-11-10',result:{...baseInput.result,marketValue:1300000}},{id:'trend-2',createdAt:'2026-11-10T10:00:00.000Z'}),
  registry.createRecord({...baseInput,name:'Склад Север',assessmentDate:'2026-11-10',result:{...baseInput.result,marketValue:1350000}},{id:'trend-3',createdAt:'2026-11-10T12:00:00.000Z'}),
  registry.createRecord({...baseInput,name:'Склад Юг',assessmentDate:'2026-11-10'},{id:'trend-4',createdAt:'2026-11-10T11:00:00.000Z'})
 ];
 const points=registry.buildTrendSeries(records,'property::склад север');
 assert.equal(points.length,2);
 assert.deepEqual(points.map(row=>row.value),[1250000,1350000]);
 assert.equal(registry.buildTrendSeries(records,'property::склад юг').length,1);
});
test('history trend UI is accessible, consent-gated and uses an SVG chart',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/js/asset-valuation-registry.js'),'utf8');
 assert.match(source,/registry-history-chart/);
 assert.match(source,/registry-trend-select/);
 assert.match(source,/aria-label/);
 assert.match(source,/consent\.checked/);
 assert.match(source,/createElementNS/);
});

test('comparison series normalizes each asset to its first observation and rejects mixed currencies',()=>{
 const records=[
  registry.createRecord({...baseInput,name:'Склад Север',assessmentDate:'2026-11-01'},{id:'compare-1',createdAt:'2026-11-01T10:00:00.000Z'}),
  registry.createRecord({...baseInput,name:'Склад Север',assessmentDate:'2026-11-10',result:{...baseInput.result,marketValue:1500000}},{id:'compare-2',createdAt:'2026-11-10T10:00:00.000Z'}),
  registry.createRecord({...baseInput,name:'Склад Юг',assessmentDate:'2026-11-03',result:{...baseInput.result,marketValue:2000000}},{id:'compare-3',createdAt:'2026-11-03T10:00:00.000Z'}),
  registry.createRecord({...baseInput,name:'Склад Юг',assessmentDate:'2026-11-12',result:{...baseInput.result,marketValue:1800000}},{id:'compare-4',createdAt:'2026-11-12T10:00:00.000Z'})
 ];
 const series=registry.buildComparisonSeries(records,['property::склад север','property::склад юг']);
 assert.equal(series.length,2);
 assert.deepEqual(series[0].points.map(point=>point.index),[100,120]);
 assert.deepEqual(series[1].points.map(point=>point.index),[100,90]);
 const mixed=[...records,registry.createRecord({...baseInput,name:'Склад USD',currency:'USD',assessmentDate:'2026-11-04'},{id:'compare-usd',createdAt:'2026-11-04T10:00:00.000Z'})];
 assert.throws(()=>registry.buildComparisonSeries(mixed,['property::склад север','property::склад usd']),/одной валюте/);
});
test('comparison chart supports multi-select, preserves selection and avoids date interpolation',()=>{
 const source=fs.readFileSync(path.join(__dirname,'../assets/js/asset-valuation-registry.js'),'utf8');
 assert.match(source,/select\.multiple=true/);
 assert.match(source,/previousSelection\.includes\(key\)/);
 assert.match(source,/Пропущенные даты не интерполируются/);
 assert.match(source,/Базовая точка каждого — 100/);
});
