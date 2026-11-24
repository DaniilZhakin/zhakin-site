(function(root){
 'use strict';
 const KINDS=['business','property','equipment'];
 const CURRENCIES=['RUB','USD','EUR','CNY'];
 function validDate(value){
  const date=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(date+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
 }
 function finite(value){return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));}
 function buildMethodRows(result,kind){
  if(!result||typeof result!=='object')return [];
  if(kind==='property'){
   const rows=[];
   if(finite(result.marketValue))rows.push({method:result.method||'Сравнительный подход',value:Number(result.marketValue),note:'Площадь × введённая цена аналога за м²; качество аналогов отдельно не проверяется.'});
   if(finite(result.incomeValue))rows.push({method:result.incomeMethod||'Доходный подход',value:Number(result.incomeValue),note:'Годовой NOI ÷ введённая ставка капитализации.'});
   return rows;
  }
  if(kind==='business'&&finite(result.equityValue))return [{method:result.method||'Доходно-рыночный ориентир (EV / EBITDA)',value:Number(result.equityValue),note:'Стоимость собственного капитала; EV: '+Number(result.enterpriseValue).toLocaleString('ru-RU')+'. Долг и денежные средства учтены отдельно.'}];
  if(kind==='equipment'&&finite(result.value))return [{method:result.method||'Затратный подход',value:Number(result.value),note:'Стоимость замещения за вычетом введённого совокупного износа.'}];
  return [];
 }
 function createEntry(input){
  if(!input||!KINDS.includes(input.kind))throw new Error('Неизвестный тип объекта.');
  if(!input.result||typeof input.result.method!=='string'||!input.result.method.trim())throw new Error('Нет подтверждённого результата расчёта.');
  const value=input.result.equityValue??input.result.marketValue??input.result.value;
  if(!finite(value))throw new Error('В результате отсутствует расчётная стоимость.');
  if(!CURRENCIES.includes(input.currency))throw new Error('Выберите поддерживаемую валюту.');
  if(!validDate(input.assessmentDate))throw new Error('Укажите корректную дату оценки.');
  const name=String(input.name||'').trim().slice(0,60)||'Объект';
  return {name,kind:input.kind,method:input.result.method,value:Number(value),low:finite(input.result.low)?Number(input.result.low):null,high:finite(input.result.high)?Number(input.result.high):null,currency:input.currency,assessmentDate:input.assessmentDate};
 }
 function addEntry(entries,input){
  if(!Array.isArray(entries))throw new Error('Некорректный список сравнения.');
  if(entries.length>=4)throw new Error('В сравнении может быть не более четырёх объектов.');
  const entry=createEntry(input);
  if(entries.length&&entries.some(existing=>existing.currency!==entry.currency))throw new Error('Сравнение возможно только в одной валюте. Очистите список перед сменой валюты.');
  entries.push(entry);return entry;
 }
 function buildMethodSpread(rows){
  if(!Array.isArray(rows))return [];
  const valid=rows.filter(row=>row&&typeof row.method==='string'&&row.method.trim()&&finite(row.value)&&Number(row.value)>=0);
  const maximum=Math.max(0,...valid.map(row=>Number(row.value)));
  return valid.map(row=>({method:row.method,value:Number(row.value),share:maximum>0?Number(row.value)/maximum:0}));
 }
 const api={createEntry,addEntry,buildMethodRows,buildMethodSpread};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.ZhakinValuationComparison=api;
})(typeof window!=='undefined'?window:globalThis);
