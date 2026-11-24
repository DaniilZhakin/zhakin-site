(function(root){
 'use strict';
 const STORAGE_KEY='zhakin.assetValuation.registry.v1';
 const SCHEMA_VERSION=1;
 const MAX_RECORDS=100;
 const KINDS=['business','property','equipment'];
 const CURRENCIES=['RUB','USD','EUR','CNY'];
 function validDate(value){
  const date=String(value||'');
  if(!/^\\d{4}-\\d{2}-\\d{2}$/.test(date))return false;
  const parsed=new Date(date+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
 }
 function finite(value){return value!==null&&value!==undefined&&value!==''&&Number.isFinite(Number(value));}
 function normalizeRecord(record){
  if(!record||typeof record!=='object'||!KINDS.includes(record.kind)||!CURRENCIES.includes(record.currency))return null;
  if(typeof record.id!=='string'||!record.id||typeof record.method!=='string'||!record.method.trim()||!finite(record.value)||!validDate(record.assessmentDate))return null;
  const createdAt=String(record.createdAt||'');
  if(!Number.isFinite(Date.parse(createdAt)))return null;
  return {
   id:record.id.slice(0,80),
   name:String(record.name||'Объект').trim().slice(0,60)||'Объект',
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
  if(!storage||typeof storage.getItem!=='function')throw new Error('Локальное хранилище недоступно.');
  const raw=storage.getItem(STORAGE_KEY);
  if(!raw)return [];
  let parsed;try{parsed=JSON.parse(raw);}catch(_){return [];}
  if(!parsed||parsed.schemaVersion!==SCHEMA_VERSION||!Array.isArray(parsed.records))return [];
  return parsed.records.map(normalizeRecord).filter(Boolean).slice(0,MAX_RECORDS);
 }
 function write(storage,records){
  if(!storage||typeof storage.setItem!=='function')throw new Error('Локальное хранилище недоступно.');
  storage.setItem(STORAGE_KEY,JSON.stringify({schemaVersion:SCHEMA_VERSION,records:records.slice(0,MAX_RECORDS)}));
 }
 function save(storage,record){
  const normalized=normalizeRecord(record);if(!normalized)throw new Error('Некорректная запись оценки.');
  const records=read(storage).filter(item=>item.id!==normalized.id);
  records.unshift(normalized);write(storage,records);return normalized;
 }
 function remove(storage,id){
  const records=read(storage).filter(item=>item.id!==String(id));write(storage,records);return records;
 }
 function clear(storage){
  if(!storage||typeof storage.removeItem!=='function')throw new Error('Локальное хранилище недоступно.');
  storage.removeItem(STORAGE_KEY);
 }
 function csvCell(value){return '"'+String(value??'').replace(/"/g,'""')+'"';}
 function toCsv(records){
  const rows=Array.isArray(records)?records.map(normalizeRecord).filter(Boolean):[];
  const header=['Объект','Тип','Метод','Стоимость','Валюта','Дата оценки','Дата сохранения'];
  const body=rows.map(row=>[row.name,row.kind,row.method,row.value,row.currency,row.assessmentDate,row.createdAt]);
  return [header,...body].map(row=>row.map(csvCell).join(';')).join('\\r\\n');
 }
 const api={STORAGE_KEY,MAX_RECORDS,createRecord,read,save,remove,clear,toCsv};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.ZhakinValuationRegistry=api;
})(typeof window!=='undefined'?window:globalThis);
