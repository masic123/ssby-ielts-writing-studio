import {createHash} from "node:crypto";
import type {ScoringSample} from "../../src/lib/scoring-samples";

export type EvaluationRow = {
  sampleId:string; task:string; examType:string; goldBand:number;
  predictedCriteria:Record<string,number>|null; predictedBand:number|null;
  delta:number|null; absError:number|null; usedVisual:boolean;
  status:"ok"|"error"; elapsedMs:number; attempts:number; error?:string;
  requestHash?:string;responseId?:string;model?:string;usage?:Record<string,number>;
  assessment?:Record<string,{score:number;reason:string;evidence:string}>;
  generation?:{thinking:boolean;maxTokens:number;temperature:number};rawPath?:string;
};
const hash=(s:string)=>createHash("sha256").update(s).digest("hex");
const normalize=(s:string)=>s.toLowerCase().replace(/writing task [12]|you should spend about \d+ minutes on this task\.?|write about the following topic:?|give reasons for your answer[\s\S]*|write (?:at least|no fewer than) \d+ words[\s\S]*/g," ").replace(/[^a-z0-9]+/g," ").trim();
function similar(a:string,b:string){
  if(a===b)return true;
  const terms=(s:string)=>new Set(s.split(" ").filter(x=>x.length>2));const x=terms(a),y=terms(b);
  let common=0;for(const term of x)if(y.has(term))common++;
  return Math.min(x.size,y.size)>=10 && common/Math.max(1,x.size+y.size-common)>=0.82;
}
export function evaluationSplit(samples:ScoringSample[]){
  const eligible=samples.filter(s=>s.band!==null&&!s.isUnscoredModelAnswer);
  const parent=eligible.map((_,i)=>i);const find=(i:number):number=>parent[i]===i?i:parent[i]=find(parent[i]);
  for(let i=0;i<eligible.length;i++)for(let j=0;j<i;j++){
    const a=eligible[i],b=eligible[j];
    if(a.task!==b.task||a.examType!==b.examType)continue;
    if(similar(normalize(a.question),normalize(b.question))||similar(normalize(a.essay),normalize(b.essay))||(a.imageUrls.length>0&&a.imageUrls.some(x=>b.imageUrls.includes(x))))parent[find(i)]=find(j);
  }
  const grouped=new Map<number,ScoringSample[]>();for(let i=0;i<eligible.length;i++){const key=find(i),list=grouped.get(key)||[];list.push(eligible[i]);grouped.set(key,list);}
  const groups=[...grouped.values()].map(items=>({id:hash(items.map(s=>s.id).sort().join("|")).slice(0,16),stratum:items[0].task+"-"+items[0].examType,sampleIds:items.map(s=>s.id).sort()}));
  const development:string[]=[],holdout:string[]=[];
  for(const stratum of [...new Set(groups.map(g=>g.stratum))].sort()){
    const items=groups.filter(g=>g.stratum===stratum).sort((a,b)=>hash("ielts-blind-audit-20261028-v1"+a.id).localeCompare(hash("ielts-blind-audit-20261028-v1"+b.id)));
    const count=Math.max(1,Math.round(items.length*0.3));
    for(let i=0;i<items.length;i++)(i<count?holdout:development).push(...items[i].sampleIds);
  }
  return {development:development.sort(),holdout:holdout.sort(),groups:groups.sort((a,b)=>a.id.localeCompare(b.id))};
}

export function metrics(rows:EvaluationRow[]){
  const valid=rows.filter(r=>r.status==="ok"&&r.absError!==null&&r.delta!==null);
  if(!valid.length)return {n:0,mae:null,rmse:null,bias:null,withinHalf:null,exact:null};
  const avg=(fn:(r:EvaluationRow)=>number)=>valid.reduce((s,r)=>s+fn(r),0)/valid.length;
  return {n:valid.length,mae:avg(r=>r.absError!),rmse:Math.sqrt(avg(r=>r.delta!**2)),bias:avg(r=>r.delta!),withinHalf:avg(r=>Number(r.absError!<=0.5)),exact:avg(r=>Number(r.absError===0))};
}
export function summarize(rows:EvaluationRow[]){
  const groups=new Map<string,EvaluationRow[]>();
  for(const row of rows)for(const key of ["all",row.task,`${row.task}-${row.examType}`,`gold-${row.goldBand}`]){const list=groups.get(key)||[];list.push(row);groups.set(key,list);}
  return Object.fromEntries([...groups].map(([key,group])=>[key,metrics(group)]));
}
