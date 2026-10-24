import assetData from './assets.generated.json';
import { OnlineGameService } from './service';
import { D1RoomRepository, type D1Database } from './repository';
import { executeRpc } from './rpc';

type Asset = { body:string; type:string };
const assets:Record<string,Asset>=assetData;
interface Env { DB:D1Database }
const json=(body:unknown,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'}});

export default {
  async fetch(request:Request,env:Env):Promise<Response> {
    const url=new URL(request.url);
    if(url.pathname==='/api/config'&&request.method==='GET')return json({joinOrigin:url.origin,pollInterval:1000,online:true});
    if(url.pathname==='/api/health'&&request.method==='GET')return json({ok:true,service:'alibi'});
    if(url.pathname==='/api/rpc'){
      if(request.method!=='POST')return json({ok:false,error:'Use POST for room operations.'},405);
      if(!request.headers.get('content-type')?.toLowerCase().includes('application/json'))return json({ok:false,error:'Use a JSON request.'},415);
      if(Number(request.headers.get('content-length')||0)>16384)return json({ok:false,error:'Request is too large.'},413);
      if(!env.DB)return json({ok:false,error:'Online room storage is not available.'},503);
      let input:unknown;
      try {const body=await request.text();if(new TextEncoder().encode(body).byteLength>16384)return json({ok:false,error:'Request is too large.'},413);input=JSON.parse(body);}
      catch{return json({ok:false,error:'Invalid JSON request.'},400);}
      const result=await executeRpc(new OnlineGameService({repository:new D1RoomRepository(env.DB)}),input);
      return json(result,result.ok?200:['TEMPORARY','BUSY'].includes(result.errorCode||'')?503:400);
    }
    if(url.pathname.startsWith('/api/'))return json({ok:false,error:'Endpoint not found.'},404);
    if(!['GET','HEAD'].includes(request.method))return new Response('Method not allowed',{status:405});
    const path=url.pathname==='/'?'/index.html':url.pathname;
    const asset=assets[path]??(path.startsWith('/assets/')?undefined:assets['/index.html']);
    if(!asset)return new Response('Not found',{status:404});
    const bytes=Uint8Array.from(atob(asset.body),c=>c.charCodeAt(0));
    return new Response(request.method==='HEAD'?null:bytes,{headers:{
      'Content-Type':asset.type,'Cache-Control':/-[a-zA-Z0-9_-]{8,}\.(js|css|woff2)$/.test(path)?'public,max-age=31536000,immutable':path.startsWith('/assets/')?'public,max-age=3600,must-revalidate':'no-cache',
      'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer'
    }});
  }
};
