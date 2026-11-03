(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.PlatinumAnalitica=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const dayKey=value=>{const d=new Date(value);return Number.isNaN(d.getTime())?null:new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(d);};
  const hour=value=>Number(new Intl.DateTimeFormat('en-GB',{timeZone:'America/Lima',hour:'2-digit',hourCycle:'h23'}).format(new Date(value)));
  const status=value=>String(value||'').toUpperCase().replaceAll(' ','_');
  function analyze(services,calls,{days=30,now=new Date()}={}){
    if(![7,30,90].includes(days))throw Error('Período no válido');
    const current=dayKey(now),anchor=new Date(current+'T12:00:00-05:00');
    const daily=Array.from({length:days},(_,i)=>{const d=new Date(anchor);d.setUTCDate(d.getUTCDate()-(days-1-i));return {date:dayKey(d),count:0,completed:0,revenue:0};});
    const selected=new Set(daily.map(d=>d.date)),byDay=new Map(daily.map(d=>[d.date,d]));
    const filtered=services.filter(s=>selected.has(dayKey(s.creado_en))),filteredCalls=calls.filter(c=>selected.has(dayKey(c.inicio)));
    const hours=Array.from({length:24},(_,h)=>({hour:h,count:0})),zones={},states={};let revenue=0,completed=0,cancelled=0;
    filtered.forEach(s=>{const d=byDay.get(dayKey(s.creado_en)),st=status(s.estado);d.count++;hours[hour(s.creado_en)].count++;states[st]=(states[st]||0)+1;const zone=String(s.origen||'Sin origen registrado');zones[zone]=(zones[zone]||0)+1;if(st==='COMPLETADO'){completed++;const amount=Number(s.tarifa);if(Number.isFinite(amount)&&amount>=0){revenue+=amount;d.revenue+=amount;}d.completed++;}if(st==='CANCELADO')cancelled++;});
    const seenDays=[...new Set(services.map(s=>dayKey(s.creado_en)).filter(d=>selected.has(d)))];
    const earliest=seenDays.sort()[0];const elapsed=earliest?daily.filter(d=>d.date>=earliest):[];
    const enough=elapsed.length>=7;
    const window=elapsed.slice(-7),mean=window.length?window.reduce((a,d)=>a+d.count,0)/window.length:0;
    const prediction=Array.from({length:7},(_,i)=>{const d=new Date(anchor);d.setUTCDate(d.getUTCDate()+i+1);return {date:dayKey(d),count:enough?Math.round(mean):null};});
    // Backtesting temporal de un paso: se usan siempre siete días anteriores al observado.
    const errors=elapsed.slice(7).map((d,i)=>Math.abs(d.count-elapsed.slice(i,i+7).reduce((a,x)=>a+x.count,0)/7));
    const durations=filteredCalls.map(c=>Number(c.duracion_segundos)).filter(n=>Number.isFinite(n)&&n>0);
    return {days,total:filtered.length,completed,cancelled,revenue,completionRate:filtered.length?completed/filtered.length*100:0,totalCalls:filteredCalls.length,averageDuration:durations.length?Math.round(durations.reduce((a,b)=>a+b,0)/durations.length):null,daily,hours,zones:Object.entries(zones).map(([zone,count])=>({zone,count})).sort((a,b)=>b.count-a.count),states,prediction,forecast:{method:'Media móvil de 7 días',available:enough,sampleDays:elapsed.length,mae:errors.length?errors.reduce((a,b)=>a+b,0)/errors.length:null,validationPoints:errors.length},services:filtered,calls:filteredCalls};
  }
  function seed(now=new Date()){
    const services=[],calls=[],zones=['El Golf','California','Centro Histórico','Mansiche','Víctor Larco','Huanchaco'];
    const base=new Date(dayKey(now)+'T00:00:00-05:00');let id=1;
    for(let d=34;d>=0;d--){const count=12+(34-d)%7+((34-d)*3%5);for(let j=0;j<count;j++){
      const date=new Date(base);date.setUTCDate(date.getUTCDate()-d);date.setUTCHours(5+(7+j%15),j*7%60,0,0);
      const st=j%13===0?'CANCELADO':d===0&&j>count-3?'PENDIENTE':'COMPLETADO';
      services.push({id,codigo:'DEMO-'+String(id).padStart(4,'0'),cliente:'Pasajero de ejemplo '+(1+id%16),origen:zones[(j+d)%6],destino:j%3?'Centro Histórico':'Aeropuerto Carlos Martínez',categoria:j%3?'sedan':'suv',estado:st,tarifa:18+id%25,creado_en:date.toISOString()});
      calls.push({id,inicio:date.toISOString(),duracion_segundos:45+id%96,estado:j%19?'COMPLETADA':'PERDIDA'});id++;
    }}
    return {services,calls,source:'demo'};
  }
  return {analyze,seed,dayKey,status};
});
