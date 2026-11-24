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
