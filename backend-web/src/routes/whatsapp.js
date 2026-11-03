const express=require('express');
const {createHmac,timingSafeEqual}=require('crypto');
const pool=require('../db/pool');
const router=express.Router();
router.get('/',(req,res)=>{
  if(process.env.WHATSAPP_VERIFY_TOKEN && req.query['hub.mode']==='subscribe' && req.query['hub.verify_token']===process.env.WHATSAPP_VERIFY_TOKEN)return res.type('text/plain').send(String(req.query['hub.challenge'] || ''));
  res.sendStatus(403);
});
router.post('/',async(req,res,next)=>{
  const secret=process.env.WHATSAPP_APP_SECRET;
  const expected=Buffer.from(secret?'sha256='+createHmac('sha256',secret).update(req.rawBody || '').digest('hex'):'');
  const actual=Buffer.from(req.get('X-Hub-Signature-256') || '');
  if(!expected.length || expected.length!==actual.length || !timingSafeEqual(expected,actual))return res.sendStatus(403);
  try {
    await pool.context.run({schema:'public'},async()=>{
      const rank={ENVIADO:1,ENTREGADO:2,LEIDO:3};
      for(const entry of req.body.entry || [])for(const change of entry.changes || [])for(const status of change.value?.statuses || []){
        const value={sent:'ENVIADO',delivered:'ENTREGADO',read:'LEIDO',failed:'ERROR'}[status.status];
        if(!value)continue;
        // Delivery callbacks can arrive out of order; never downgrade a read/delivered message.
        await pool.query(`UPDATE notificaciones_whatsapp SET estado=$2,actualizado_en=NOW() WHERE external_id=$1
          AND ((CASE estado WHEN 'LEIDO' THEN 3 WHEN 'ENTREGADO' THEN 2 WHEN 'ENVIADO' THEN 1 ELSE 0 END)<=$3
            OR ($2='ERROR' AND estado NOT IN ('LEIDO','ENTREGADO')))`,[status.id,value,rank[value] || 0]);
      }
    });res.json({ok:true});
  }catch(e){next(e);}
});
module.exports=router;
