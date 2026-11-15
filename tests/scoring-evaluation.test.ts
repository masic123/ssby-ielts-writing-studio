import {test} from "node:test";
import assert from "node:assert/strict";
import {scoringSamples} from "../src/lib/scoring-samples";
import {evaluationMessages} from "../scripts/evaluate-scoring-samples";
import {evaluationSplit,metrics,type EvaluationRow} from "../scripts/lib/scoring-evaluation";
import {selectAuditedScoringSamples} from "../src/lib/scoring-calibration-set";
import {questions} from "../src/lib/content";

test("blind audit isolates same-question groups and covers each scored response once", {skip: scoringSamples.length ? false : "Private historical calibration corpus is not distributed."},()=>{
  const split=evaluationSplit(scoringSamples),eligible=scoringSamples.filter(s=>s.band!==null&&!s.isUnscoredModelAnswer);
  assert.equal(split.development.length+split.holdout.length,97);
  assert.equal(new Set([...split.development,...split.holdout]).size,97);
  assert.equal(split.holdout.some(id=>split.development.includes(id)),false);
  for(const group of split.groups){
    const allDevelopment=group.sampleIds.every(id=>split.development.includes(id));
    const allHoldout=group.sampleIds.every(id=>split.holdout.includes(id));
    assert.ok(allDevelopment!==allHoldout);
  }
  for(const sample of eligible){
    const messages=evaluationMessages(sample,"baseline");
    const user=messages[1].content as {type:string;text:string}[];
    const data=JSON.parse(user[0].text);
    assert.deepEqual(Object.keys(data).sort(),["essay","question","scoringRubric"]);
    assert.deepEqual(Object.keys(data.question).sort(),["examType","stem","task"]);
    assert.equal(data.essay,sample.essay);
    assert.equal(JSON.stringify(data).includes(sample.comment),false);
    assert.equal(JSON.stringify(data).includes(sample.sourceUrl),false);
    assert.equal("band" in data,false);
    assert.equal("title" in data,false);
    const anchored=evaluationMessages(sample,"anchored-calibrated-v1");
    const anchoredData=JSON.parse((anchored[1].content as {text:string}[])[0].text);
    for(const reference of anchoredData.calibrationSamples){
      assert.notEqual(reference.response,sample.essay);
      assert.notEqual(reference.examinerComment,sample.comment);
      const known=scoringSamples.find(s=>s.essay===reference.response)!;
      assert.ok(split.development.includes(known.id));
      assert.ok(!split.groups.find(g=>g.sampleIds.includes(sample.id))!.sampleIds.includes(known.id));
    }
  }
});

test("evaluation metrics use signed error, half-band tolerance, and successful rows only",()=>{
  const base={sampleId:"fixture",task:"Task 2",examType:"A",goldBand:6,predictedCriteria:null,usedVisual:false,status:"ok" as const,elapsedMs:0,attempts:1};
  const rows:EvaluationRow[]=[{...base,predictedBand:5,delta:-1,absError:1},{...base,predictedBand:6.5,delta:0.5,absError:0.5},{...base,status:"error",predictedBand:null,delta:null,absError:null}];
  const m=metrics(rows);
  assert.equal(m.n,2);assert.equal(m.mae,0.75);assert.equal(m.bias,-0.25);assert.equal(m.withinHalf,0.5);assert.equal(m.exact,0);
});

test("production excludes target question groups even when exam instructions or punctuation differ", {skip: scoringSamples.length ? false : "Private historical calibration corpus is not distributed."},()=>{
  const split=evaluationSplit(scoringSamples),base=questions()[0];
  for(const sample of scoringSamples.filter(s=>s.band!==null)){
    const stem=sample.question.replace(/WRITING TASK [12]/gi,"").replace(/You should spend about \d+ minutes on this task\.?/gi,"").replace(/[^a-z0-9?'.\s]/gi," ");
    const anchors=selectAuditedScoringSamples({...base,task:sample.task,examType:sample.examType,stem},"Independent new essay about the same question.");
    const forbidden=split.groups.find(g=>g.sampleIds.includes(sample.id))!.sampleIds;
    for(const anchor of anchors){assert.ok(split.development.includes(anchor.id));assert.ok(!forbidden.includes(anchor.id));}
  }
});
