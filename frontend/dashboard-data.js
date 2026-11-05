(function(root) {
  'use strict';
  async function loadDashboardData(request) {
    const sources = [
      ['servicios','/servicios',true], ['conductores','/conductores',true],
      ['pasajeros','/pasajeros',true], ['usuarios','/acceso/usuarios',true],
      ['resumen','/resumen',false], ['health','/health',false]
    ];
    const outcomes = await Promise.allSettled(sources.map(([,route])=>request(route)));
    const data = {}, errors = {};
    outcomes.forEach((outcome,index)=>{
      const [key,,array] = sources[index];
      if(outcome.status==='fulfilled' && (!array || Array.isArray(outcome.value))) data[key]=outcome.value;
      else {
        const error=outcome.status==='rejected'?outcome.reason:new Error('La API devolvió un formato inesperado.');
        if(error.status===401) throw error;
        errors[key]=error.message; data[key]=array?[]:null;
      }
    });
    return {data,errors};
  }
  root.loadDashboardData=loadDashboardData;
  if(typeof module==='object' && module.exports)module.exports={loadDashboardData};
})(typeof globalThis!=='undefined'?globalThis:this);
