export type ScoringPolicyVersion = "baseline" | "calibrated-v1" | "anchored-baseline" | "anchored-calibrated-v1" | "anchored-reasoning-v1" | "evidence-guided-v2" | "evidence-reviewed-v2";
// The stricter multi-stage chart experiment remains available for diagnostics.
// Its factual regressions and schema rejection rate do not justify production use.
export const productionScoringPolicy: ScoringPolicyVersion = "evidence-guided-v2";
export const assessmentVersion = "evidence-guided-integer-20261110-v3";

// Shared by the production report prompt and the independent score-only audit.
// A more polished rewrite is not evidence of a failure against a descriptor.
export const baselineScoringPolicy = `评分以实际质量为准，与目标分无关。TA/TR、CC、LR、GRA 四项小分只能是 0 至 9 的整数，不允许 6.5、7.5 等半分。逐项依据官方整数档量表选择最符合的档位，不能先给半分再四舍五入或截断。单篇总分由程序汇总，可以出现半分；参考样本的 overallTaskBand 是总分，不能当作小分档位。不能把建议的四段式、两句开头、Overall 一词或固定模板当作官方硬性规则。不得捏造数据、作者原句、原书页码或不存在的方法。语法准确性独立评价。
评分流程：先按 scoringRubric 对 TA（Task 1）/TR（Task 2）、CC、LR、GRA 各自逐档判断。每项 reason 必须结合该项量表要求，evidence 必须包含本篇原文的具体依据；不同维度不能只给同一句笼统评语。
逐项自查：TR/TA 应判断任务是否被充分回答，而不是要求每一句解释都附一个例子，或要求已有清晰论证无限加深才给7分。GRA 必须把句法范围与准确性分开观察：若以语法错误限制分数，reason 必须引用实际错误并指出具体语法点；不能只写“有少量错误”却拿正确从句当错误证据。若语法准确，应承认其准确性，再按实际句法范围与灵活性定档，不能为提出建议而压低分数。搭配、选词或自然度问题不能作为GRA语法错误；普通但正确自然的表达也不能当作LR缺陷。不要先预设6分、7分或目标分，再寻找扣分理由。`;

export const descriptorBoundaryCalibration = `评分尺度复核（依据开发组盲评与考官评语所归纳的通用原则，不是额外分数公式）：
先记录每项已经展示出的正面能力，再判断负面表现的频率、严重程度及对阅读的实际影响。按全篇最符合的量表档位判断，不从满分逐个数错扣分，也不能因为还可以润色就把整项封顶6分。6、7、8分都可以存在错误；8分不要求达到学术期刊编辑水平。低分同样必须依据整体能力，不得为了纠正偏严而普遍加分。
TR/TA：区分没有回答、回答但展开有限、相关观点已解释支持、充分展开。不能把“还能更深入”“可再举例”自动当成未充分回答。观点题可以坚持一个立场，正反篇幅无需相等；不能把未同等讨论反方当作缺陷。支持可以是解释、因果、具体情境或例子；不要求每个观点都再附一个例子或统计数字。不用外部百科知识考查考生举例的史实，再据此否定整篇回应；检查例子与论点的关联和文中逻辑。
CC：判断读者能否轻松跟随整体和段内推进。Firstly、However等常见连接词，以及句首重复主题词，本身不是机械衔接的证据；指代、同义承接、段落关系也是衔接。一个TR问题不应重复当成CC组织混乱，除非确实出现难以跟随的关系。Task 1没有独立概述段或使用单段，不构成固定分数上限；概述可嵌在其他位置，按实际趋势、比较和组织判断。
LR：查看词汇范围、准确的主题词和自然搭配的整体表现。出现几处拼写错误并不等于词汇有限；若词义清楚，不可声称妨碍理解。常见自然短语或具体、清楚的普通词不需要改成更正式同义词；高分依赖恰当、灵活与精确。给低于7的范围或精确性判断时，应与已经呈现的词汇能力一并权衡，不能只挑错误。
GRA：按全篇无误句的比例、复杂结构的实际范围与控制判断。正确的条件句、从句、非谓语、并列和多分句都要计入正面证据；不能把没有倒装等某个特定句型当作范围有限。先确认所引句子真的有语法错误；标点可评价，但拼写、词汇选择与搭配不重复当成语法错误。存在少量明显失误与“大量复杂结构基本准确”可以并存；只有错误频繁且真正影响交流时才据此选择相应低档。
逐项给分后再核对：每个低档判断是否有满足该档负面描述的具体证据，而非仅有可选改进；每个高档判断是否也有充分正面证据。不得按样本总体分倒推四项。`;

export function scoringPolicy(version: ScoringPolicyVersion = "baseline") {
  if (version === "baseline") return baselineScoringPolicy;
  if (version === "calibrated-v1") return baselineScoringPolicy + "\n" + descriptorBoundaryCalibration;
  if (version === "anchored-baseline") return baselineScoringPolicy + "\n" + anchorComparisonPolicy;
  if (version === "anchored-calibrated-v1" || version === "anchored-reasoning-v1") return baselineScoringPolicy + "\n" + descriptorBoundaryCalibration + "\n" + anchorComparisonPolicy;
  if (version === "evidence-reviewed-v2" || version === "evidence-guided-v2") return baselineScoringPolicy + "\n" + descriptorBoundaryCalibration + "\n" + anchorComparisonPolicy + "\n" + evidenceReviewPolicy;
  throw new Error("Unknown scoring policy version");
}

export const anchorComparisonPolicy = `校准参照：calibrationSamples 是其他作文的考官整体分与评语，用于理解相邻分数档的实际能力要求。先独立判断本篇四项，再逐项对照示例呈现的语言范围、准确性、展开和阅读流畅度，检查相同程度的长处和错误是否被你评价得明显更严或更松；有差异时按量表重新判断，不按分数做平均。参考只有单篇整体分，不能推导其四项人工标签，更不能把参考分数直接赋给本篇。题目不同不代表语言要求不同；Task 1参考图未提供，不重裁参考数据，也不借参考补全本次题图。参考为第三方转录，不能假称已核实全部原版。`;

export const evidenceReviewPolicy = `证据复核规则（来自反馈质量诊断，不是加分或扣分公式）：
每项reason先说明全篇已展示的能力，再说明真正限制档位的表现、出现频率与交流影响。不要把四项复制成同一档位，也不要因文章较长、词汇普通或存在可选润色就推断退步；高分也必须有对应能力，不能矫枉普遍提分。每项evidence逐字摘录本篇一个连续英文片段。
对TR/CC的限制也要反证：只要立场回答题目且原因、情境或例子已经支撑观点，就不能把未说明每项实施细节、师资或具体课程范围自动判为展开不足；两个不同情境可以共同支持同一论点，用Similarly等承接也可合理。区分读者确实无法跟随与评估者偏好另一套论证安排。
给出的每项限制必须可定位：语法/标点错误引用完整相关结构，给出必要的最小改法；先检验原句是否有合法分析。主句内含since等从句不妨碍其与另一个独立分句用分号连接；并列谓语可以分别带不同的情态或时态。不要凭局部截句制造错误。词汇、拼写、搭配问题不放GRA；GRA若仅受范围限制，应承认准确性，说明实际句式分布，不能把缺某个指定句型当硬错。
例如单数主语可以共享为“X can do A and helps B”，后半部分可独立陈述事实，不必强制把helps改help；要先区分“两个谓语共享主语”与“两个动词共享情态动词”。不能把这种合法结构当主谓不一致或并列错误。
词汇普通不等于不恰当；另一写法更正式、简洁、常见不证明原句不自然。正常比喻、英美变体、可省略that的从句以及一般规律的一般现在时不自动扣分。自然度问题要指明具体搭配/语境不合，不能以“可更高级”代替证据。
Task 1先核实题图，再判断文章：chartEvidence是另一次不看作文的题图读取，仍可能有错，必须与原图交叉核验，不能当人工真值。优先核对图例类别、轴/单位/季度、最高最低的例外、地图数量与移动、流程箭头与分叉。calculatedShares是按列出的同组数值程序计算的比例，核对其输入后使用，不另凭口算改变分子/分母或国家数量。
读图不确定或题源矛盾不能当成已确认的考生错误，不能编造另一个精确数字来扣分；在理由中说明能核实的范围。图中标签本身不自动是英语习惯用法的标准。图表内容错误主要按TA评价，不因同一事实错再无依据压低GRA/CC；独立存在的语言或组织缺陷另给证据。
评分只看提交的文章，不知道它是否修改过。不得设置“优化稿必须涨分”、固定补偿、平均两次取高分或依据用户目标分调整。建议再多也不能反过来制造分数限制。`;
