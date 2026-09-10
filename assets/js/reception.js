(function(){
  const form=document.getElementById('reception-form');
  const preview=document.getElementById('reception-preview');
  const output=document.getElementById('reception-output');
  const status=document.getElementById('reception-status');
  const copy=document.getElementById('reception-copy');
  if(!form||!preview||!output||!status)return;

  const labels={international:'Международное сотрудничество',investment:'Экономические и инвестиционные проекты',analytics:'Аналитика и экспертное взаимодействие',social:'Социальные и общественные инициативы',other:'Другое'};
  const clean=v=>v.replace(/[ \t]+/g,' ').trim();
  const show=(text,ok)=>{status.hidden=false;status.textContent=text;status.dataset.state=ok?'success':'error';};

  form.addEventListener('submit',function(e){
    e.preventDefault();
    const honeypot=form.querySelector('[name="website"]');
    if(honeypot&&honeypot.value){show('Обращение не сформировано.',false);return;}
    if(!form.reportValidity())return;
    const data=new FormData(form);
    const topic=labels[data.get('topic')]||'Другое';
    const name=clean(String(data.get('name')||''));
    const org=clean(String(data.get('organization')||''));
    const contact=clean(String(data.get('contact')||''));
    const message=clean(String(data.get('message')||''));
    const text=['ОБРАЩЕНИЕ В ОФИЦИАЛЬНУЮ ПРИЁМНУЮ','',`Тема: ${topic}`,`Имя: ${name}`,`Организация: ${org||'не указана'}`,`Контакт: ${contact}`,'',`Содержание:\n${message}`,'','Подтверждаю, что не направляю пароли, платёжные данные и иную избыточную конфиденциальную информацию.'].join('\n');
    output.value=text;
    preview.hidden=false;
    show('Обращение подготовлено. Скопируйте текст и передайте его через официальный контактный канал.',true);
    output.focus();
  });

  form.addEventListener('reset',function(){preview.hidden=true;status.hidden=true;output.value='';});

  if(copy)copy.addEventListener('click',async function(){
    const text=output.value;
    try{await navigator.clipboard.writeText(text);show('Текст обращения скопирован. Теперь его можно передать через официальный контактный канал.',true);}
    catch(err){output.focus();output.select();show('Автоматическое копирование недоступно. Текст выделен — скопируйте его вручную.',true);}
  });
})();