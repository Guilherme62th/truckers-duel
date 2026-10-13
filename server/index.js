const express=require("express");
const { chromium }=require("playwright");
const fs=require("fs");
const path=require("path");
const app=express(),PORT=process.env.PORT||3000;
const CACHE_MS=60*60*1000;
const DATA=path.join(__dirname,"data.json");
app.use(express.static(path.join(__dirname,"../public")));
const players={guilherme:{id:80613,name:"Guilherme BR",url:"https://trucksbook.eu/profile/80613"},fantasma:{id:321853,name:"Fantasma MG",url:"https://trucksbook.eu/profile/321853"}};
let cache=null,cacheAt=0;
const fallback={monthly:{guilherme:{km:62849,mode:"Real"},fantasma:{km:32481,mode:"Real + Race"}},alltime:{guilherme:{km:5626650,mode:"Real"},fantasma:{km:3993778,mode:"All"}}};

function numberFrom(s){return Number(s.replace(/[^\d]/g,""))}
async function extract(page,period,type){
  // The profile has public selectors for Monthly/All-time and ETS2 Real/Race/All.
  // We interact with the visible page instead of guessing an undocumented API.
  await page.getByText(period,{exact:true}).first().click().catch(()=>{});
  await page.getByText("ETS2",{exact:true}).first().click().catch(()=>{});
  if(type==="All") await page.getByText("All",{exact:true}).first().click().catch(()=>{});
  if(type==="Real") await page.getByText("Real",{exact:true}).first().click().catch(()=>{});
  if(type==="Race") await page.getByText("Race",{exact:true}).first().click().catch(()=>{});
  await page.waitForTimeout(900);
  const text=await page.locator("body").innerText();
  const m=[...text.matchAll(/Distance\s+([0-9][0-9 .,'\u202f]*)\s*km/gi)].map(x=>numberFrom(x[1])).filter(Number.isFinite);
  if(!m.length) throw new Error("Distância ETS2 não encontrada após selecionar "+period+" / "+type);
  return Math.max(...m);
}
async function scrapePlayer(p){
  const browser=await chromium.launch({headless:true});
  const page=await browser.newPage({locale:"pt-BR"});
  try{
    await page.goto(p.url,{waitUntil:"domcontentloaded",timeout:30000});
    await page.waitForTimeout(700);
    const monthly=await extract(page,"Monthly",p.id===321853?"All":"Real");
    const alltime=await extract(page,"All-time",p.id===321853?"All":"Real");
    return {monthly,alltime};
  }finally{await browser.close()}
}
async function refresh(){
  try{
    const [g,f]=await Promise.all([scrapePlayer(players.guilherme),scrapePlayer(players.fantasma)]);
    const old=fs.existsSync(DATA)?JSON.parse(fs.readFileSync(DATA,"utf8")):[];
    const now=new Date().toISOString();
    const result={updatedAt:now,monthLabel:new Intl.DateTimeFormat("pt-BR",{month:"long",year:"numeric",timeZone:"Europe/Madrid"}).format(new Date()).replace(/^./c=>c.toUpperCase()),
      monthly:{guilherme:{km:g.monthly,mode:"Real"},fantasma:{km:f.monthly,mode:"Real + Race"}},
      alltime:{guilherme:{km:g.alltime,mode:"Real"},fantasma:{km:f.alltime,mode:"All"}},
      history:[...old.slice(-30),{at:now,g:g.alltime,f:f.alltime}]};
    fs.writeFileSync(DATA,JSON.stringify(result,null,2));cache=result;cacheAt=Date.now();return result;
  }catch(e){
    if(cache)return cache;
    if(fs.existsSync(DATA)){cache=JSON.parse(fs.readFileSync(DATA,"utf8"));return cache}
    const now=new Date().toISOString();
    const result={updatedAt:now,monthLabel:"Outubro 2026",...fallback,history:[]};
    return result;
  }
}
app.get("/api/stats",async(req,res)=>{try{if(!cache||Date.now()-cacheAt>CACHE_MS) await refresh();res.json(cache)}catch(e){res.status(503).json({error:e.message})}});
app.get("*",(req,res)=>res.sendFile(path.join(__dirname,"../public/index.html")));
app.listen(PORT,()=>console.log("Truckers Duel listening on "+PORT));