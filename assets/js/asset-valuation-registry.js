(function(root){
 'use strict';
 const sharedHistory=root.ZhakinAssetHistory||(typeof module!=='undefined'&&module.exports&&typeof require==='function'?require('./asset-history-unification.js'):null);
 const STORAGE_KEY='zhakin.assetValuation.registry.v1';
 const SCHEMA_VERSION=1;
 const MAX_RECORDS=200;
 const KINDS=['business','property','equipment'];
 const RECORD_KINDS=[...KINDS,'other'];
 const CURRENCIES=['RUB','USD','EUR','CNY'];
 function validDate(value){
  const date=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(date+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
 }
 function finite(value){return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));}
 function normalizeRecord(record){
  if(!record||typeof record!=='object'||!RECORD_KINDS.includes(record.kind)||!CURRENCIES.includes(record.currency))return null;
  if(typeof record.id!=='string'||!record.id||typeof record.method!=='string'||!record.method.trim()||!finite(record.value)||!validDate(record.assessmentDate))return null;
  const createdAt=String(record.createdAt||'');
  if(!Number.isFinite(Date.parse(createdAt)))return null;
  return {
   id:record.id.slice(0,80),
   name:String(record.name||'Объект').trim().slice(0,80)||'Объект',
   kind:record.kind,
   method:record.method.trim().slice(0,160),
   value:Number(record.value),
   low:finite(record.low)?Number(record.low):null,
   high:finite(record.high)?Number(record.high):null,
   currency:record.currency,
   assessmentDate:record.assessmentDate,
   createdAt:new Date(createdAt).toISOString()
  };
 }
 function createRecord(input,metadata){
  if(!input||!KINDS.includes(input.kind))throw new Error('Неизвестный тип объекта.');
  if(!input.result||typeof input.result.method!=='string'||!input.result.method.trim())throw new Error('Нет результата расчёта для сохранения.');
  if(!CURRENCIES.includes(input.currency))throw new Error('Выберите поддерживаемую валюту.');
  if(!validDate(input.assessmentDate))throw new Error('Укажите корректную дату оценки.');
  const value=input.result.equityValue??input.result.marketValue??input.result.value;
  if(!finite(value))throw new Error('В результате отсутствует расчётная стоимость.');
  const meta=metadata||{};
  const record=normalizeRecord({
   id:meta.id||('valuation-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,10)),
   name:String(input.name||'').trim().slice(0,60)||'Объект',
   kind:input.kind,method:input.result.method,value:Number(value),
   low:input.result.low,high:input.result.high,currency:input.currency,
   assessmentDate:input.assessmentDate,createdAt:meta.createdAt||new Date().toISOString()
  });
  if(!record)throw new Error('Не удалось сформировать корректную запись оценки.');
  return record;
 }
 function read(storage){
  if(sharedHistory)return sharedHistory.read(storage);
  if(!storage||typeof storage.getItem!=='function')throw new Error('Локальное хранилище недоступно.');
  const raw=storage.getItem(STORAGE_KEY);
  if(!raw)return [];
  let parsed;try{parsed=JSON.parse(raw);}catch(_){return [];}
  if(!parsed||parsed.schemaVersion!==SCHEMA_VERSION||!Array.isArray(parsed.records))return [];
  return parsed.records.map(normalizeRecord).filter(Boolean).slice(0,MAX_RECORDS);
 }
 function write(storage,records){
  if(sharedHistory)return sharedHistory.write(storage,records);
  if(!storage||typeof storage.setItem!=='function')throw new Error('Локальное хранилище недоступно.');
  storage.setItem(STORAGE_KEY,JSON.stringify({schemaVersion:SCHEMA_VERSION,records:records.slice(0,MAX_RECORDS)}));
 }
 function save(storage,record){
  const normalized=normalizeRecord(record);if(!normalized)throw new Error('Некорректная запись оценки.');
  if(sharedHistory)return sharedHistory.save(storage,normalized);
  const records=read(storage).filter(item=>item.id!==normalized.id);
  records.unshift(normalized);write(storage,records);return normalized;
 }
 function remove(storage,id){
  if(sharedHistory)return sharedHistory.remove(storage,id);
  const records=read(storage).filter(item=>item.id!==String(id));write(storage,records);return records;
 }
 function clear(storage){
  if(sharedHistory)return sharedHistory.clear(storage);
  if(!storage||typeof storage.removeItem!=='function')throw new Error('Локальное хранилище недоступно.');
  storage.removeItem(STORAGE_KEY);
 }
 function csvCell(value){
  let text=String(value??'');
  // Prevent spreadsheet formula execution from user-controlled text fields.
  if(typeof value==='string'&&/^[\s\u0000-\u001F]*[=+\-@]/.test(text))text="'"+text;
  return '"'+text.replace(/"/g,'""')+'"';
 }
 function toCsv(records){
  const rows=Array.isArray(records)?records.map(normalizeRecord).filter(Boolean):[];
  const header=['Объект','Тип','Метод','Стоимость','Валюта','Дата оценки','Дата сохранения'];
  const body=rows.map(row=>[row.name,row.kind,row.method,row.value,row.currency,row.assessmentDate,row.createdAt]);
  return [header,...body].map(row=>row.map(csvCell).join(';')).join('\r\n');
 }
 function assetKey(record){return record.kind+'::'+record.name.toLocaleLowerCase('ru-RU');}
 function buildTrendSeries(records,key){
  const valid=Array.isArray(records)?records.map(normalizeRecord).filter(Boolean):[];
  const byDate=new Map();
  valid.filter(row=>assetKey(row)===key).forEach(row=>{
   const previous=byDate.get(row.assessmentDate);
   if(!previous||row.createdAt>previous.createdAt)byDate.set(row.assessmentDate,row);
  });
  return [...byDate.values()].sort((a,b)=>a.assessmentDate.localeCompare(b.assessmentDate));
 }
 function buildComparisonSeries(records,keys){
  const selected=Array.isArray(keys)?[...new Set(keys)].slice(0,4):[];
  if(!selected.length)return [];
  const series=selected.map(key=>{
   const points=buildTrendSeries(records,key);
   if(!points.length)return null;
   const first=points[0].value;
   return {key,name:points[0].name,kind:points[0].kind,currency:points[0].currency,points:points.map(point=>({date:point.assessmentDate,value:point.value,index:first===0?null:point.value/first*100}))};
  }).filter(Boolean);
  const currencies=new Set(series.map(item=>item.currency));
  if(currencies.size>1)throw new Error('Для сравнения выберите объекты в одной валюте.');
  return series;
 }
 function mountHistoryChart(){
  if(!root.document||root.document.getElementById('registry-history-chart'))return;
  const consent=root.document.getElementById('registry-local-consent');
  const table=root.document.querySelector('.av-registry .av-comparison-table-wrap');
  if(!consent||!table)return;
  const doc=root.document,section=doc.createElement('section');section.id='registry-history-chart';section.className='av-registry-chart';
  const heading=doc.createElement('div');heading.className='av-registry-chart-head';
  const title=doc.createElement('h4');title.textContent='История и сравнение стоимости';
  const note=doc.createElement('p');note.textContent='Выберите до четырёх объектов в одной валюте. Для сопоставления используется индекс: первая оценка каждого объекта = 100. Пропущенные даты не интерполируются.';
  heading.append(title,note);
  const controls=doc.createElement('div');controls.className='av-registry-chart-controls';
  const label=doc.createElement('label');label.htmlFor='registry-trend-select';label.textContent='Объекты для сравнения';
  const select=doc.createElement('select');select.id='registry-trend-select';select.multiple=true;select.size=4;select.disabled=true;select.setAttribute('aria-describedby','registry-trend-help');controls.append(label,select);
  const help=doc.createElement('small');help.id='registry-trend-help';help.textContent='На компьютере используйте Ctrl/Cmd для выбора нескольких объектов; на телефоне отметьте нужные строки.';controls.append(help);
  const summary=doc.createElement('p');summary.className='av-registry-chart-summary';summary.setAttribute('aria-live','polite');summary.textContent='Включите локальное хранение, чтобы построить график.';
  const legend=doc.createElement('div');legend.className='av-registry-chart-legend';
  const svg=doc.createElementNS('http://www.w3.org/2000/svg','svg');svg.setAttribute('viewBox','0 0 720 270');svg.setAttribute('role','img');svg.setAttribute('aria-label','Сравнение динамики сохранённых оценок');svg.classList.add('av-registry-trend-svg');
  const style=doc.createElement('style');style.textContent='.av-registry-chart{margin:16px 0;padding:16px;border:1px solid rgba(212,175,55,.16);border-radius:10px;background:rgba(4,17,12,.28)}.av-registry-chart-head h4{margin:0;color:#ead9aa;font-size:.9rem}.av-registry-chart-head p,.av-registry-chart-summary{margin:6px 0;color:#91a398;font-size:.68rem;line-height:1.55}.av-registry-chart-controls{display:grid;grid-template-columns:minmax(0,1fr);gap:6px;max-width:460px;margin:12px 0}.av-registry-chart-controls label{color:#bdc9c1;font-size:.68rem}.av-registry-chart-controls select{width:100%;min-height:100px;padding:8px 10px;border:1px solid rgba(212,175,55,.25);border-radius:7px;background:#071a16;color:#f4f1e8}.av-registry-chart-controls small{color:#81958a;font-size:.64rem;line-height:1.5}.av-registry-chart-legend{display:flex;flex-wrap:wrap;gap:8px 14px;margin:10px 0}.av-registry-chart-legend span{display:inline-flex;align-items:center;gap:6px;color:#bdc9c1;font-size:.66rem}.av-registry-chart-legend i{display:inline-block;width:18px;height:3px;border-radius:3px}.av-registry-trend-svg{display:block;width:100%;height:auto;min-height:150px;overflow:visible}.av-registry-trend-svg text{font-family:inherit}.av-registry-trend-svg .grid{stroke:rgba(212,175,55,.16);stroke-width:1}.av-registry-trend-svg .series-line{fill:none;stroke-width:3;stroke-linecap:round;stroke-linejoin:round}.av-registry-trend-svg .point{stroke:#071a16;stroke-width:2}.av-registry-trend-svg .axis-label{fill:#91a398;font-size:11px}.av-registry-trend-svg .value-label{fill:#f1dfaa;font-size:10px}@media(max-width:520px){.av-registry-chart{padding:12px}.av-registry-trend-svg{min-height:120px}.av-registry-chart-controls select{min-height:132px}}';
  doc.head.append(style);section.append(heading,controls,summary,legend,svg);table.parentNode.insertBefore(section,table);
  const ns='http://www.w3.org/2000/svg',palette=['#d4af37','#69b98b','#8aa9d6','#c58bd8'];
  function node(name,attrs,text){const el=doc.createElementNS(ns,name);Object.entries(attrs||{}).forEach(([key,value])=>el.setAttribute(key,String(value)));if(text!==undefined)el.textContent=text;return el;}
  function draw(){
   const previousSelection=[...select.selectedOptions].map(option=>option.value);
   svg.replaceChildren();select.replaceChildren();legend.replaceChildren();
   if(!consent.checked){select.disabled=true;summary.textContent='График скрыт до включения локального хранения.';return;}
   let records;try{records=read(root.localStorage);}catch(_){select.disabled=true;summary.textContent='Браузер не предоставил доступ к локальной истории.';return;}
   const assets=new Map();records.forEach(row=>assets.set(assetKey(row),row));
   const keys=[...assets.keys()];keys.forEach((key,index)=>{const row=assets.get(key),option=doc.createElement('option');option.value=key;option.textContent=row.name+' · '+({business:'Бизнес',property:'Недвижимость',equipment:'Оборудование'}[row.kind]||row.kind);select.append(option);option.selected=previousSelection.length?previousSelection.includes(key):index<2;});
   select.disabled=!keys.length;
   if(!keys.length){summary.textContent='Сохраните оценки, чтобы построить динамику.';return;}
   const selected=[...select.selectedOptions].map(option=>option.value);
   if(!selected.length){summary.textContent='Выберите один или несколько объектов.';return;}
   if(selected.length>4){summary.textContent='Для сравнения выберите не более четырёх объектов.';return;}
   let series;try{series=buildComparisonSeries(records,selected);}catch(error){summary.textContent=error.message;return;}
   const drawable=series.filter(item=>item.points.length>=2&&item.points[0].index!==null);
   if(!drawable.length){summary.textContent='Для выбранных объектов пока недостаточно дат оценки. Нужны минимум две даты и ненулевая первая стоимость.';return;}
   const dates=drawable.flatMap(item=>item.points.map(point=>point.date)),first=Math.min(...dates.map(date=>Date.parse(date+'T00:00:00Z'))),last=Math.max(...dates.map(date=>Date.parse(date+'T00:00:00Z')));
   const values=drawable.flatMap(item=>item.points.map(point=>point.index)).filter(Number.isFinite),min=Math.min(...values),max=Math.max(...values),spread=max-min||5,low=Math.min(100,min-spread*.15),high=Math.max(100,max+spread*.15);
   const x0=64,x1=690,y0=28,y1=205;
   const x=date=>first===last?(x0+x1)/2:x0+(x1-x0)*(Date.parse(date+'T00:00:00Z')-first)/(last-first);
   const y=value=>y1-(value-low)/(high-low)*(y1-y0);
   for(let i=0;i<5;i++){const value=low+(high-low)*i/4,yy=y(value);svg.append(node('line',{x1:x0,y1:yy,x2:x1,y2:yy,class:'grid'}));svg.append(node('text',{x:x0-9,y:yy+4,'text-anchor':'end',class:'axis-label'},Math.round(value).toString()));}
   drawable.forEach((item,index)=>{
    const color=palette[index%palette.length],points=item.points;
    svg.append(node('polyline',{points:points.map(point=>x(point.date)+','+y(point.index)).join(' '),class:'series-line',stroke:color}));
    points.forEach(point=>svg.append(node('circle',{cx:x(point.date),cy:y(point.index),r:4,fill:color,class:'point'})));
    const legendItem=doc.createElement('span'),swatch=doc.createElement('i');swatch.style.backgroundColor=color;legendItem.append(swatch,doc.createTextNode(item.name));legend.append(legendItem);
   });
   const startDate=new Date(first).toISOString().slice(0,10),endDate=new Date(last).toISOString().slice(0,10);
   svg.append(node('text',{x:x0,y:232,class:'axis-label'},startDate));svg.append(node('text',{x:x1,y:232,'text-anchor':'end',class:'axis-label'},endDate));
   summary.textContent='Индексная динамика: '+drawable.length+' объекта(ов). Базовая точка каждого — 100; показано фактическое количество сохранённых дат без интерполяции.';
   svg.setAttribute('aria-label','Сравнение индексной динамики '+drawable.map(item=>item.name).join(', ')+' с '+startDate+' по '+endDate);
  }
  select.addEventListener('change',draw);consent.addEventListener('change',draw);
  const rows=doc.getElementById('registry-rows');
  if(rows&&typeof MutationObserver!=='undefined'){const observer=new MutationObserver(draw);observer.observe(rows,{childList:true,subtree:true});}
  draw();
 }
 if(typeof module!=='undefined'&&module.exports)module.exports={STORAGE_KEY,MAX_RECORDS,createRecord,read,save,remove,clear,toCsv,buildTrendSeries,buildComparisonSeries,assetKey};
 if(root)root.ZhakinValuationRegistry={STORAGE_KEY,MAX_RECORDS,createRecord,read,save,remove,clear,toCsv,buildTrendSeries,buildComparisonSeries,assetKey};
 if(root.document){if(root.document.readyState==='loading')root.document.addEventListener('DOMContentLoaded',mountHistoryChart,{once:true});else mountHistoryChart();}
})(typeof window!=='undefined'?window:globalThis);
