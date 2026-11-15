import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";
import { scoringCardMessages, parseScoringCard } from "../src/lib/scoring-card";
import { scoringSamples, type ScoringSample } from "../src/lib/scoring-samples";
import { selectAuditedScoringSamples } from "../src/lib/scoring-calibration-set";
import type {Question} from "../src/lib/types";
import { scoringPolicy, type ScoringPolicyVersion } from "../src/lib/scoring-policy";
import { evaluationSplit, summarize, type EvaluationRow } from "./lib/scoring-evaluation";

const hash = (x: string | Buffer) => createHash("sha256").update(x).digest("hex");
const root = "storage/scoring-evaluation-20261028";
const criteria = ["taskResponse", "coherence", "lexical", "grammar"] as const;
const images = new Map<string, Promise<string>>();

export function evaluationMessages(sample: ScoringSample, version: ScoringPolicyVersion, image?: string) {
  const q = {task: sample.task, examType: sample.examType};
  let anchors:ScoringSample[]=[];
  if(version.startsWith("anchored-")){
    const query:Question={...q,id:0,name:"",category:"",topic:"",book:"",test:"",date:"",stem:sample.question,sourceType:"",sourceUrl:"",futureDate:false,images:[]};
    anchors=selectAuditedScoringSamples(query,sample.essay);
  }
  return scoringCardMessages({...q,stem:sample.question},sample.essay,version,anchors,image?[image]:[]);
}

async function imageFor(url: string): Promise<string> {
  if (!images.has(url)) images.set(url, (async () => {
    const filename = root + "/images/" + hash(url) + ".image";
    let bytes: Buffer;
    try { bytes = await readFile(filename); }
    catch {
      const response = await fetch(url, {signal:AbortSignal.timeout(45000)});
      if(!response.ok) throw new Error("Task image HTTP " + response.status);
      bytes = Buffer.from(await response.arrayBuffer());
      if(bytes.length>5_000_000) throw new Error("Oversized task image");
      await mkdir(dirname(filename),{recursive:true});await writeFile(filename,bytes);
    }
    const mime=bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))?"image/png":bytes[0]===255&&bytes[1]===216?"image/jpeg":bytes.toString("ascii",0,4)==="RIFF"&&bytes.toString("ascii",8,12)==="WEBP"?"image/webp":null;
    if(!mime)throw new Error("Unsupported task image format");
    return "data:"+mime+";base64,"+bytes.toString("base64");
  })());
  return images.get(url)!;
}

async function main() {
  process.loadEnvFile(".env.local");
  const apiKey=process.env.DEEPSEEK_API_KEY;if(!apiKey)throw new Error("Missing provider key");
  const model=process.env.DEEPSEEK_MODEL||"deepseek-flash";
  const baseUrl=(process.env.DEEPSEEK_BASE_URL||"https://api.deepseek.com").replace(/\/$/,"");
  if(baseUrl!=="https://api.deepseek.com")throw new Error("This experiment uses the existing official DeepSeek endpoint only");
  const splitName=process.env.SCORING_EVAL_SPLIT||"development";
  if(!["development","holdout"].includes(splitName))throw new Error("Invalid evaluation split");
  const version=(process.env.SCORING_EVAL_POLICY||"baseline") as ScoringPolicyVersion;
  const mode=process.env.SCORING_EVAL_MODE||"score";
  const split=evaluationSplit(scoringSamples);
  const pool=scoringSamples.filter(s=>s.band!==null&&!s.isUnscoredModelAnswer);
  const protocol={version:2,seed:"ielts-blind-audit-20261028-v1",datasetHash:hash(JSON.stringify(scoringSamples)),split,model,temperature:0.1,mode:"score-only; official rubric; target score/comment/title/URL hidden; anchored variants use other development question groups only",metrics:["MAE","RMSE","signed bias","exact","within 0.5"],selectionRule:"Lock one candidate after development analysis. Compare on untouched question-group holdout. Adopt only if holdout MAE decreases, within-half does not decrease, and no task/module MAE worsens by >0.15. Otherwise retain baseline.",limitations:["Third-party transcriptions have not all been independently matched to original official documents.","Labels are overall single-task bands, not four human criterion scores.","Public material may have been seen during pretraining; this cannot measure novel-essay generalization.","Score-only mode shares production scoring rules, but does not generate a full editing report."]};
  await mkdir(root,{recursive:true});
  try { const previous=JSON.parse(await readFile(root+"/protocol.json","utf8"));if(previous.datasetHash!==protocol.datasetHash||JSON.stringify(previous.split)!==JSON.stringify(split))throw new Error("Dataset/protocol changed"); }
  catch(error) {if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;await writeFile(root+"/protocol.json",JSON.stringify(protocol,null,2));}
  if(mode==="prepare") { console.log(JSON.stringify({protocol:root+"/protocol.json",development:split.development.length,holdout:split.holdout.length,groups:split.groups.length}));return; }
  if(splitName==="holdout") {
    const lock=JSON.parse(await readFile(root+"/candidate-lock.json","utf8"));
    if(![...lock.comparisonPolicies,lock.candidatePolicy].includes(version)||lock.model!==model||lock.policyHashes[version]!==hash(scoringPolicy(version)))throw new Error("Policy is not part of the frozen holdout comparison");
  }
  const ids=new Set(split[splitName as "development"|"holdout"]);
  let eligible=pool.filter(s=>ids.has(s.id));
  if(process.env.SCORING_EVAL_IDS)eligible=eligible.filter(s=>process.env.SCORING_EVAL_IDS!.split(",").includes(s.id));
  if(process.env.SCORING_EVAL_LIMIT)eligible=eligible.slice(0,Number(process.env.SCORING_EVAL_LIMIT));
  const output=root+`/${version}-${splitName}.json`;
  let rows:EvaluationRow[]=[];
  try{const prior=JSON.parse(await readFile(output,"utf8"));if(prior.model!==model||prior.policyHash!==hash(scoringPolicy(version)))throw new Error("Resume configuration differs");rows=prior.rows;}
  catch(error){if((error as NodeJS.ErrnoException).code!=="ENOENT")throw error;}
  const pending=eligible.filter(s=>!rows.some(r=>r.sampleId===s.id&&r.status==="ok"));
  let cursor=0,serial=Promise.resolve();
  const save=()=>{serial=serial.then(async()=>{const doc={version:2,model,policyVersion:version,policyHash:hash(scoringPolicy(version)),split:splitName,updatedAt:new Date().toISOString(),rows,...(splitName==="development"?{summary:summarize(rows)}:{})};await writeFile(output+".next",JSON.stringify(doc,null,2));await rename(output+".next",output);});return serial;};
  const concurrency=Math.max(1,Math.min(6,Number(process.env.SCORING_EVAL_CONCURRENCY||4)));
  console.log(JSON.stringify({model,policy:version,split:splitName,total:eligible.length,alreadyCompleted:rows.filter(r=>r.status==="ok").length,pending:pending.length,concurrency}));
  async function worker(){
    while(cursor<pending.length){
      const sample=pending[cursor++],started=Date.now();let image:string|undefined,errorMessage="",attempt=0;
      let result:EvaluationRow|undefined;
      try{
        if(sample.task==="Task 1"&&sample.examType==="A"){if(!sample.imageUrls.length)throw new Error("Missing task image");image=await imageFor(sample.imageUrls[0]);}
        const messages=evaluationMessages(sample,version,image),requestHash=hash(JSON.stringify(messages));
        for(attempt=1;attempt<=2;attempt++){
          try{
            const reasoning=version==="anchored-reasoning-v1";
            const maxTokens=reasoning?24000:1800;
            const response=await fetch(baseUrl+"/chat/completions",{method:"POST",headers:{Authorization:`Bearer ${apiKey}`,"Content-Type":"application/json"},body:JSON.stringify({model,messages,response_format:{type:"json_object"},thinking:{type:reasoning?"enabled":"disabled"},temperature:0.1,max_tokens:maxTokens}),signal:AbortSignal.timeout(240000)});
            if(!response.ok)throw new Error("Provider HTTP "+response.status);
            const payload=await response.json() as {id:string;model:string;usage:Record<string,number>;choices:{finish_reason:string;message:{content:string}}[]};
            await mkdir(root+"/raw/"+version+"-"+splitName,{recursive:true});
            const rawPath=root+"/raw/"+version+"-"+splitName+"/"+sample.id+"-"+Date.now()+"-"+attempt+".json";
            await writeFile(rawPath,JSON.stringify(payload,null,2));
            if(payload.choices[0]?.finish_reason!=="stop")throw new Error("Truncated or empty response");
            const envelope=JSON.parse(payload.choices[0].message.content);
            const raw={criteria:parseScoringCard(envelope)},scores={} as Record<typeof criteria[number],number>;
            for(const key of criteria)scores[key]=raw.criteria[key].score;
            const predictedBand=Math.round(Object.values(scores).reduce((a,b)=>a+b,0)/4*2)/2;
            result={sampleId:sample.id,task:sample.task,examType:sample.examType,goldBand:sample.band!,predictedCriteria:scores,predictedBand,delta:predictedBand-sample.band!,absError:Math.abs(predictedBand-sample.band!),usedVisual:!!image,status:"ok",elapsedMs:Date.now()-started,attempts:attempt,requestHash,responseId:payload.id,model:payload.model,usage:payload.usage,assessment:raw.criteria,generation:{thinking:reasoning,maxTokens,temperature:0.1},rawPath};break;
          }catch(error){errorMessage=error instanceof Error?error.message:String(error);if(/HTTP (401|402)/.test(errorMessage))throw error;}
        }
      }catch(error){errorMessage=error instanceof Error?error.message:String(error);}
      result??={sampleId:sample.id,task:sample.task,examType:sample.examType,goldBand:sample.band!,predictedCriteria:null,predictedBand:null,delta:null,absError:null,usedVisual:!!image,status:"error",elapsedMs:Date.now()-started,attempts:attempt,error:errorMessage};
      rows=rows.filter(r=>r.sampleId!==sample.id);rows.push(result);await save();
      console.log(JSON.stringify({completed:rows.filter(r=>r.status==="ok").length,total:eligible.length,split:splitName,status:result.status,...(result.status==="error"?{error:result.error}:{}),...(splitName==="development"?{sampleId:sample.id,gold:sample.band,predicted:result.predictedBand,delta:result.delta}:{})}));
    }
  }
  await Promise.all(Array.from({length:Math.min(concurrency,pending.length)},()=>worker()));await save();
  console.log(JSON.stringify({output,success:rows.filter(r=>r.status==="ok").length,failed:rows.filter(r=>r.status==="error").length,...(splitName==="development"?{summary:summarize(rows)}:{})}));
}

if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href)void main().catch(error=>{console.error(error);process.exitCode=1;});
