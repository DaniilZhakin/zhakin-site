(function(root){
 'use strict';
 const REQUIRED={
  business:[['ebitda','EBITDA',true],['multiple','Мультипликатор EV / EBITDA',true],['debt','Финансовый долг',false],['cash','Денежные средства',false]],
  property:[['area','Площадь',true],['pricePerSqm','Цена аналога за м²',true]],
  equipment:[['replacementCost','Стоимость нового аналога',true],['depreciation','Совокупный износ',false]]
 };
 function finite(value){return value!==''&&value!==null&&value!==undefined&&Number.isFinite(Number(value));}
 function isValidDate(value){
  const date=String(value||'');
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date))return false;
  const parsed=new Date(date+'T00:00:00Z');
  return Number.isFinite(parsed.getTime())&&parsed.toISOString().slice(0,10)===date;
 }
 function buildQualityReport(input){
  const kind=input&&input.kind,fields=REQUIRED[kind];
  if(!fields)throw new Error('Неизвестный тип актива для паспорта качества.');
  const values=input.inputs||{};
  const completed=fields.filter(([key,,positive])=>finite(values[key])&&(positive?Number(values[key])>0:Number(values[key])>=0));
  const completeness={value:completed.length+'/'+fields.length+' обязательных',state:completed.length===fields.length?'good':'missing',note:completed.length===fields.length?'Все обязательные параметры прошли форматную проверку.':'Не прошли проверку: '+fields.filter(([key])=>!completed.some(row=>row[0]===key)).map(row=>row[1]).join(', ')+'.'};
  let methods;
  if(kind==='property'){
   const noi=finite(values.noi)&&Number(values.noi)>0,cap=finite(values.capRate)&&Number(values.capRate)>0&&Number(values.capRate)<=100;
   if(noi&&cap)methods={value:'2 из 2 доступных',state:'good',note:'Рассчитаны сравнительный и доходный подходы.'};
   else if(!noi&&!cap)methods={value:'1 из 2 доступных',state:'warning',note:'Доходный подход не рассчитан: NOI и ставка капитализации не представлены.'};
   else methods={value:'1 из 2 доступных',state:'missing',note:'Для второго подхода нужны одновременно NOI и ставка капитализации.'};
  }else{
   methods={value:'1 из 1 в текущей модели',state:'warning',note:kind==='business'?'Использован один ориентир EV / EBITDA; DCF и независимые рыночные мультипликаторы не рассчитываются.':'Использован затратный ориентир; техническое обследование и рыночные аналоги не проверяются.'};
  }
  const dateOk=isValidDate(input.assessmentDate);
  const date={value:dateOk?input.assessmentDate:'Не указана / некорректна',state:dateOk?'good':'missing',note:dateOk?'Дата задана пользователем; независимое подтверждение даты не выполняется.':'Укажите реальную дату оценки в формате календарного поля.'};
  const description=String(input.sourceDescription||'').trim();
  const rawUrl=String(input.sourceUrl||'').trim();
  let href='',urlValid=false;
  if(rawUrl){try{const parsed=new URL(rawUrl);urlValid=parsed.protocol==='https:'&&Boolean(parsed.hostname);if(urlValid)href=parsed.href;}catch(_){}}
  let source;
  if(rawUrl&&!urlValid)source={value:'Ссылка некорректна',state:'missing',note:'Допускаются только корректные HTTPS-ссылки; ссылка не открывалась и не проверялась.'};
  else if(description&&href)source={value:'Описание и ссылка указаны',state:'good',note:'Реквизиты предоставлены пользователем; содержание источника не верифицировано.'};
  else if(description||href)source={value:'Документировано частично',state:'warning',note:'Указаны не все реквизиты. Предоставленные сведения не прошли независимую проверку.'};
  else source={value:'Не документированы',state:'warning',note:'Добавьте название документа/источника и HTTPS-ссылку, если она доступна.'};
  const limitations=[
   'Проверка подтверждает только заполнение и допустимый формат параметров, а не достоверность исходных данных.',
   kind==='property'?'Качество и сопоставимость аналогов, права, состояние и местоположение объекта не проверяются.':kind==='business'?'EBITDA, мультипликатор, долг и денежные средства не подтверждаются отчётностью; результат не заменяет DCF и полноценный анализ капитала.':'Совокупный износ задаётся пользователем; техническое состояние и стоимость замещения независимым обследованием не подтверждаются.',
   input.result&&input.result.assumptions?String(input.result.assumptions):'Диапазон результата является условной чувствительностью, а не доверительным интервалом.',
   'Предварительный расчёт не заменяет независимую профессиональную оценку.'
  ];
  const complete=completed.length===fields.length&&dateOk;
  const overallLabel=complete?'Расчёт сформирован · источники требуют проверки':'Есть незакрытые проверки';
  return {completeness,methods,date,source:{...source,href},limitations,overallLabel};
 }
 const api={isValidDate,buildQualityReport};
 if(typeof module!=='undefined'&&module.exports)module.exports=api;
 if(root)root.ZhakinValuationQuality=api;
})(typeof window!=='undefined'?window:globalThis);
