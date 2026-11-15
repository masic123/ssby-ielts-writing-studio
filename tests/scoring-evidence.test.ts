import { test } from "node:test";
import assert from "node:assert/strict";
import { parseGroundedScoringCard } from "../src/lib/scoring-card";
import { parseChartFacts, chartFactsMessages, type ChartFacts } from "../src/lib/chart-facts";
import { parseProviderCompletion } from "../src/lib/provider-completion";
import { groundedCorrections } from "../src/lib/feedback-policy";
import { assessEssay } from "../src/lib/reviewer";
import { questions } from "../src/lib/content";
import { askTeacher, teacherInputSchema } from "../src/lib/teacher";
import { readQuestionImage } from "../src/lib/question-reader";

const essay = "The number of visitors remained stable, while ticket prices rose.";
const criteria = Object.fromEntries(["taskResponse","coherence","lexical","grammar"].map(key => [key,{score:7,reason:"原文体现相应能力，按量表判断。",evidence:essay}]));
const card = {criteria,limitations:{taskResponse:[],coherence:[],lexical:[],grammar:[]}};
const facts = {readable:true,chartType:"table",legend:[],axesAndUnits:["Percent"],observations:[{statement:"Public exceeds private.",support:"Public and private columns.",certainty:"clear"}],readings:[],uncertainties:[],sourceConflicts:[]};

test("score evidence must belong to this essay and grammatical claims need a concrete fix",()=>{
  assert.deepEqual(parseGroundedScoringCard(card,essay).criteria,criteria);
  assert.throws(()=>parseGroundedScoringCard({...card,criteria:{...criteria,grammar:{...criteria.grammar,evidence:"A sentence invented by the reviewer."}}},essay),/not in the essay/);
  const limitation={kind:"grammar",quote:essay,explanation:"incorrect verb",correction:null};
  assert.throws(()=>parseGroundedScoringCard({...card,limitations:{...card.limitations,grammar:[limitation]}},essay),/necessary correction/);
  assert.throws(()=>parseGroundedScoringCard({...card,limitations:{...card.limitations,grammar:[{...limitation,kind:"vocabulary",correction:"Another sentence."}]}},essay),/Invalid scoring limitation/);
  const aliased = { ...card, criteria: { ...criteria, lexical: { ...criteria.lexical, evidence: "\"THE NUMBER OF VISITORS\"" } }, limitations: { taskResponse: [], organisation: [], lexical: [], grammar: [] } };
  assert.equal(parseGroundedScoringCard(aliased, essay).criteria.lexical.evidence, "The number of visitors");
  assert.throws(()=>parseGroundedScoringCard(aliased, essay+" THE NUMBER OF VISITORS"),/not in the essay/);
  assert.throws(()=>parseGroundedScoringCard({ ...card, criteria: { ...criteria, lexical: { ...criteria.lexical, evidence: "The visitors remained stable" } } }, essay),/not in the essay/);
});

test("chart ratios retain the right group, units and uncertainty instead of guessing country counts",()=>{
  const readings: ChartFacts["readings"]=[];
  for(const [country,total,part] of [["France",11.4,8.6],["Germany",9.3,7],["Italy",7.7,5.3],["Japan",7.2,5.8],["USA",8.6,6]] as const) {
    for(const [role,value] of [["total",total],["part",part]] as const) readings.push({id:country+role,group:country,label:role,value,unit:"%",role,approximate:false,certainty:"clear",support:country+" row"});
  }
  const parsed=parseChartFacts({...facts,readings});
  assert.equal(parsed.calculatedShares.length,5);
  assert.equal(parsed.calculatedShares.filter(r=>r.exceedsTwoThirds).length,5);
  const near=parseChartFacts({...facts,readings:[{...readings[0],value:100,approximate:true},{...readings[1],value:67,approximate:true}]});
  assert.equal(near.calculatedShares[0].exceedsTwoThirds,null);
  const otherUnit=parseChartFacts({...facts,readings:[readings[0],{...readings[1],unit:"people"}]});
  assert.equal(otherUnit.calculatedShares.length,0);
  assert.throws(()=>parseChartFacts({...facts,readings:[readings[0],readings[0]]}),/Duplicate/);
});

test("chart extraction has no essay or scores and optional corrections cannot masquerade as necessary errors",()=>{
  const request=chartFactsMessages({task:"Task 1",examType:"A",stem:"Compare the two maps."},["data:image/png;base64,AA=="]);
  const payload=JSON.parse((request[1].content as {text:string}[])[0].text);
  assert.deepEqual(Object.keys(payload),["question"]);
  const correction={original:essay,replacement:"Visitor numbers remained steady while ticket prices increased.",kind:"naturalness"};
  const raw={corrections:[correction],correctionChecks:[{original:essay,necessary:false,basis:"usage",explanation:"只是可选同义改写。"}]};
  assert.deepEqual(groundedCorrections(raw).corrections,[]);
  assert.throws(()=>groundedCorrections({...raw,correctionChecks:[]}),/Missing/);
  assert.throws(()=>groundedCorrections({...raw,corrections:[{...correction,kind:"grammar"}],correctionChecks:[{...raw.correctionChecks[0],necessary:true}]}),/syntax evidence/);
});

test("complete relay streams are accepted; keepalives, truncation and mixed models never become a score",()=>{
  const chunk=(x:unknown)=>`data: ${JSON.stringify(x)}\n\n`;
  const stream=": keepalive\n\n"+chunk({model:"deepseek-v4.1-flash",choices:[{index:0,delta:{content:'{"criteria":'},finish_reason:null}]})+chunk({model:"deepseek-v4.1-flash",choices:[{index:0,delta:{content:'{}}'},finish_reason:"stop"}]})+"data: [DONE]\n\n";
  assert.equal(parseProviderCompletion(stream).choices[0].message.content,'{"criteria":{}}');
  assert.throws(()=>parseProviderCompletion(": keepalive\n\n"),/Incomplete/);
  assert.throws(()=>parseProviderCompletion(stream.replace("data: [DONE]\n\n","")),/Incomplete/);
  assert.throws(()=>parseProviderCompletion(stream.replace('"model":"deepseek-v4.1-flash"','"model":"other-model"')),/Mixed models/);
});

test("a readable chart is independently extracted before scoring and feedback; unreadable charts never get a total",async()=>{
  const q={...questions().find(q=>q.task==="Task 1"&&q.examType==="A")!,images:["/questions/fixture.png"]};
  const input={questionId:q.id,essay,title:"",targetBand:7};
  const feedback={summary:"这篇作文表达总体清晰，仍可练习更具体的比较。",criteria,strengths:[],priorities:[{title:"可选巩固",reason:"未发现需要强改的句子。",action:"练习比较句。"}],methodChecks:[],paragraphs:[],corrections:[],correctionChecks:[],advancedSuggestions:[],improvedEssay:essay,exercises:[]};
  const assets={fetch:async()=>new Response(new Uint8Array([1,2,3]))};
  for(const readable of [true,false]){
    let calls=0;
    const mock=(async(_url:unknown,init:RequestInit)=>{
      const body=JSON.parse(String(init.body)),data=JSON.parse(body.messages[1].content[0].text);
      calls++;
      if(calls===1)assert.deepEqual(Object.keys(data),["question"]);
      else assert.equal(data.chartEvidence.readable,readable);
      const value=calls===1?{...facts,readable}:body.thinking.type==="enabled"?card:feedback;
      return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(value)}}]});
    }) as typeof fetch;
    const report=await assessEssay(input,q,{DEEPSEEK_API_KEY:"test"},assets,mock,"evidence-reviewed-v2");
    assert.equal(calls,readable?3:2);
    assert.equal(report.overallBand,readable?7:null);
    assert.equal(report.criteria.taskResponse.score,readable?7:null);
    assert.equal(report.calibration?.chartEvidenceStatus,readable?"readable":"unreadable");
  }
});

test("relay streaming also works for question recognition and teaching without accepting a truncated answer",async()=>{
  const env={DEEPSEEK_API_KEY:"test",DEEPSEEK_BASE_URL:"https://relay.example/v1",DEEPSEEK_MODEL:"deepseek-v4.1-flash",DEEPSEEK_STREAM:"true"};
  const mock=(value:unknown)=>(async(url:unknown,init:RequestInit)=>{
    assert.equal(url,"https://relay.example/v1/chat/completions");
    assert.equal(JSON.parse(String(init.body)).stream,true);
    return new Response(`data: ${JSON.stringify({model:env.DEEPSEEK_MODEL,choices:[{index:0,delta:{content:JSON.stringify(value)},finish_reason:"stop"}]})}\n\ndata: [DONE]\n\n`);
  }) as typeof fetch;
  const reply=await askTeacher(teacherInputSchema.parse({messages:[{role:"user",content:"如何写开头？"}]}),env,mock({answer:"先回应题目，再说明立场。",sourceIds:[]}));
  assert.match(reply.answer,/回应题目/);
  const image="data:image/png;base64,"+Buffer.from([137,80,78,71,13,10,26,10]).toString("base64");
  const read=await readQuestionImage({image,task:"Task 2",examType:"A"},env,mock({stem:"Some people prefer working from home. Discuss both views.",task:"Task 2",examType:"A",category:"双边讨论题",questionCount:1,uncertain:false}));
  assert.equal(read.question.task,"Task 2");
  await assert.rejects(askTeacher(teacherInputSchema.parse({messages:[{role:"user",content:"如何写开头？"}]}),env,(async()=>new Response(": keepalive\n\n")) as typeof fetch),/不完整/);
});

test("production keeps the chart experiment disabled and checks quoted evidence before editing",async()=>{
  const q={...questions().find(q=>q.task==="Task 1"&&q.examType==="A")!,images:["/questions/fixture.png"]};
  const feedback={summary:"这篇作文表达总体清晰，可继续练习精确比较。",criteria,strengths:[],priorities:[{title:"可选巩固",reason:"未发现需要强改的句子。",action:"练习比较句。"}],methodChecks:[],paragraphs:[],corrections:[],advancedSuggestions:[],improvedEssay:essay,exercises:[]};
  let calls=0;
  const mock=(async(_url:unknown,init:RequestInit)=>{
    calls++;const body=JSON.parse(String(init.body)),data=JSON.parse(body.messages[1].content[0].text);
    assert.equal(data.essay,essay);
    assert.equal('chartEvidence' in data,false);
    assert.equal(body.messages[1].content[1].type,"image_url");
    return Response.json({choices:[{finish_reason:"stop",message:{content:JSON.stringify(body.thinking.type==="enabled"?{criteria}:feedback)}}]});
  }) as typeof fetch;
  const report=await assessEssay({questionId:q.id,essay,title:"",targetBand:7},q,{DEEPSEEK_API_KEY:"test"},{fetch:async()=>new Response(new Uint8Array([1,2,3]))},mock);
  assert.equal(calls,2);
  assert.equal(report.calibration?.assessmentVersion,"evidence-guided-integer-20261110-v3");
  assert.equal(report.calibration?.chartEvidenceStatus,undefined);
});
