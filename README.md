# 莎试笔雅 · 雅思写作练习室

面向 IELTS Academic Task 1 / Task 2 的写作练习网站，支持 AI 参考评分、逐句修改、改稿复评、独立目标提升方案与 AI 老师。

采用 Next.js / React 静态前端、Node.js 24 后端和 SQLite。AI 请求由服务端调用 DeepSeek 官方 API，密钥不会发送到浏览器。

在线体验：[https://ssbyielt.xyz](https://ssbyielt.xyz) · 另一独立项目：[译洋 · 四六级写作与翻译](https://github.com/masic123/yiyang-cet-writing-studio)

## 功能

- 邮箱账号、账号隔离的草稿和批改历史；游客只读浏览。
- Task 1 / Task 2 题库、自选题与图表上传；缺少题图时只反馈语言，不生成 TA 或总分。
- 客观评分、逐句修改、表达建议与修改稿；学习目标在评分后用于独立指导。
- 账号目标长期保存，草稿及目标同步包含版本冲突保护。
- AI 任务队列、排队进度和取消；两站共享时总并发 12、最多等待 30。
- 明暗主题、移动端界面、字数统计、计时、草稿与报告下载。

## 本机运行

需要 Node.js **24 或更新版本**，SQLite 使用 Node 内置模块。

```sh
git clone https://github.com/masic123/ssby-ielts-writing-studio.git
cd ssby-ielts-writing-studio
npm ci
cp .dev.vars.example .dev.vars
# 编辑 .dev.vars，填入自己的服务端 DEEPSEEK_API_KEY。
npm run build
npm run build:vps
npm start
```

Windows PowerShell 可用 `Copy-Item .dev.vars.example .dev.vars` 替代 `cp`。访问 http://127.0.0.1:8788 。不填 API 密钥时仍可浏览题库与使用本机练习功能，AI 请求会提示服务未配置。

后端开发：`npm run dev:node`；前端预览：`npm run dev:ui`（前端单独启动不提供完整 API）。界面变动后重新构建静态资源。

## 配置与数据

示例配置为官方接口 `https://api.deepseek.com`、`deepseek-flash`、`DEEPSEEK_STREAM=true`。真实密钥仅保存在被 Git 忽略的环境文件。生产可用环境变量覆盖，说明见 [.dev.vars.example](.dev.vars.example)。

业务数据库默认 storage/writing.sqlite。题库含 777 道 A 类题目，另保留 G 类数据记录；题目及题图的来源不代表官方完整题库。教材全文和私有带分样本不会进入仓库。构建、类型检查和测试会自动初始化空占位文件，不覆盖已导入资料；空库可以运行，但教材原文检索与样本校准不可用。需要时设置 SIMON_BOOK_PATH、QUESTION_BANK_PATH、SCORING_SAMPLES_PATH 后运行 import:content / import:scoring-samples，且仅导入有权使用的资料。

自托管步骤见 [deploy/vps/README.md](deploy/vps/README.md)。默认独立账号库；共享身份与队列需要显式迁移和配置，不包含任何线上数据。

## 验证

```sh
npm run typecheck
npm test
npm run build
npm run build:vps
```

少量教材出处、私有样本数量和校准检索测试需要自行导入原始私有资料；不包含这些资料时明确跳过对应检查，其他业务与安全测试仍执行。真实 AI 联调需自己的密钥，可能产生费用。

## 许可证与边界

原创代码采用 [MIT](LICENSE)。第三方依赖、题目、题图、考试样卷及资料仍遵循各自的权利与许可，详见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。本项目与考试机构、教材作者无官方隶属关系。

AI 评分仅供学习参考，不代替人工或正式考试评分，不承诺达到目标分。开源版本不包含用户数据、密钥、签名私钥、教材全文、运维备份或收款码。
