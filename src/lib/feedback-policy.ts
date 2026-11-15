import { z } from "zod";
import { feedbackSchema } from "./validation";

export const groundedFeedbackJSONSchema = z.toJSONSchema(feedbackSchema.extend({
  correctionChecks: z.array(z.object({
    original: z.string().min(1).max(1500),
    necessary: z.boolean(),
    basis: z.enum(["syntax", "usage", "ambiguity", "chart"]),
    explanation: z.string().min(1).max(1500),
  })).max(25),
}));

export const correctionChecksPolicy = `每条correction同时在correctionChecks中给出与其original逐字相同的原句、necessary布尔值、basis（syntax|usage|ambiguity|chart）和explanation。necessary=false表示只是可选润色，该项不应进入纠错清单。grammar分类必要纠错的basis须为syntax，不能一面说非句法问题一面放入grammar。`;

export const feedbackEvidencePolicy = `输出前完成一次逐项复核，不为展示批改工作而找茬：
corrections只列有具体问题的句子，每条reason指出问题及必要改法的依据。语法错误必须指出实际句法错误；自然度必须说明具体不自然之处，不能只说另一表达更常见/正式；清晰度须说明实际歧义，前句已给出明确先行项时不能假称指代不清；事实纠错须引用题图具体图例/行列/时点/方向/箭头支持，不能以原文不同于建议本身作为证据。只是可选润色时放advancedSuggestions，不混入corrections。
自然度、用词、清晰度与语法分类先复核。不要制造agree后必须that、描述一般规律必须完成时等绝对规则；说到已经结束的童年或其他过去阶段，一般过去时完全可以合法，不能仅因主句是现在时就强换现在完成时。先检验with复合结构、分号两侧的完整分句、并列谓语是否有合法读法。英美常见变体、正常比喻及普通自然短语可以保留。语法确有错时归grammar，不能一面说“语法正确”一面纠正主谓、冠词或句法。
事实纠错与同义进阶不同：原稿对题图的错误陈述应改为有图证的正确陈述，这种必要改意允许且应解释；advancedSuggestions的同义替换仍须保留原含义。support不自动等于subsidise，health不自动等于physical health，可能性、条件、比较程度、时间与指代范围不可偷偷改变。补充论证另放priorities；清楚而自然的原句可以原样保留。
自然的understand a situation表示理解情境，relate to a situation表示能够联系自身经历，两者不能仅以“更地道”为由互换。before they have much experience可以直接说明经验不足，不因还能增加early in life等修饰语而算表达错误。
小作文先核对原图；若提供chartEvidence，再与之交叉核对：该表是AI独立读取，可能误读，图面有疑义就说明，不把它当考官真值。流程不从管道折返推断回流；地图区分设施迁移/新增和数量；数据先核对图例、行列、季度、百分比基数、排序例外，再写比较。若提供程序计算的calculatedShares，使用前核对其输入，算式与“几国超过阈值”必须一致。保留合理估读，题源冲突单独说明，不能替考生发明精确数值。没有明确图证的数字/路线修改不能进入corrections或improvedEssay。
最后将improvedEssay逐项对照已核实事实：不能在评分、priorities、methodChecks说一种关系，改稿和进阶例句又写另一种。已有正确事实不得为润色改错。可以加入题图直接支持的比较概括，但检查每个国家、类别、时点和全部例外；不能为了“完整”虚构回流、设施、时间增长或新统计。若图不清，不用常识补全。
优先项最多3项，不强求有3个问题。没有明确问题时可给巩固练习并写明可选；不得为凑进阶词汇、句式或方法检查制造缺陷。methods标met与可选进阶可以并存，不据此声称前后矛盾。`;

export function groundedCorrections(raw: unknown) {
  if (!raw || typeof raw !== "object") throw new Error("Missing feedback");
  const report = raw as Record<string, unknown>;
  if (!Array.isArray(report.corrections) || !Array.isArray(report.correctionChecks) ||
      report.correctionChecks.length !== report.corrections.length) throw new Error("Missing correction checks");
  const checks = report.correctionChecks;
  const kept = report.corrections.filter((correction, index) => {
    const check = checks[index];
    if (!check || typeof check !== "object" || check.original !== correction.original ||
        typeof check.necessary !== "boolean" || !["syntax", "usage", "ambiguity", "chart"].includes(check.basis) ||
        typeof check.explanation !== "string" || !check.explanation.trim()) throw new Error("Invalid correction check");
    if (check.necessary && correction.kind === "grammar" && check.basis !== "syntax")
      throw new Error("Grammar correction lacks syntax evidence");
    return check.necessary;
  });
  return { ...report, corrections: kept };
}
