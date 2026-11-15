import original from "./index";
import type { Env } from "./types";
import { body } from "../src/lib/http";
export { WritingStore } from "./store";

const page = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>莎试笔雅 · 新网址</title>
<style>:root{color-scheme:light dark;--paper:#f6f7f1;--ink:#263a2b;--accent:#28533f;--on:#fffefa;--line:#d6dfcf}@media(prefers-color-scheme:dark){:root{--paper:#171e19;--ink:#e0ebd9;--accent:#b4d8a2;--on:#172615;--line:#39473b}}*{box-sizing:border-box}body{margin:0;background:var(--paper);color:var(--ink);font:16px/1.8 "Microsoft YaHei UI",system-ui,sans-serif}main{max-width:700px;padding:64px 24px;margin:0 auto}h1{font-size:32px;line-height:1.4;letter-spacing:-.04em;margin:40px 0 20px}p{margin:16px 0}a{color:var(--accent)}.go{display:inline-block;padding:12px 24px;background:var(--accent);color:var(--on);border-radius:8px;text-decoration:none;font-weight:600;margin:12px 0 28px}.old{padding-top:24px;border-top:1px solid var(--line)}a:focus-visible{outline:2px solid var(--accent);outline-offset:4px}small{font-size:14px}</style>
<main><b>莎试笔雅 · 雅思写作练习室</b><h1>换一个网址，<br>继续写下一篇。</h1><p>网站已迁至 <strong>ssbyielt.xyz</strong>。请使用原来的邮箱和密码重新登录，账号草稿与批改记录已经迁移。</p><a class="go" href="https://ssbyielt.xyz/">前往新的写作练习室</a><div class="old"><p>旧网址有未同步的本机草稿？</p><p><a href="/legacy">打开旧版，查看或下载草稿</a></p><small>本机缓存仍留在这个浏览器里。旧版已停止保存到账号和提交批改；请先下载正文与提纲，再到新网址继续。已过期的旧版登录可重新登录查看本机缓存。</small></div></main></html>`;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname === "/api/_vps-transfer" || url.pathname.startsWith("/transfer-")) return new Response(null, { status: 404 });
    if (url.pathname.startsWith("/api/") && !["GET", "HEAD"].includes(request.method)) {
      let loginOnly = false;
      if (url.pathname === "/api/auth" && request.method === "POST") {
        try {
          const data = await body(request, 5000) as { action?: string };
          loginOnly = data.action === "login" || data.action === "logout";
          if (loginOnly) request = new Request(request, { body: JSON.stringify(data) });
        } catch { /* Invalid requests stay read-only. */ }
      }
      if (!loginOnly) return Response.json({ error: "网站已迁至 https://ssbyielt.xyz，请在新网址登录原账号继续练习。" }, { status: 503, headers: { "Cache-Control": "no-store" } });
    }
    if ((url.pathname === "/" || url.pathname === "/index.html") && ["GET", "HEAD"].includes(request.method)) {
      return new Response(request.method === "HEAD" ? null : page, { headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff", "X-Frame-Options": "DENY",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; frame-ancestors 'none'", "Referrer-Policy": "strict-origin-when-cross-origin",
      } });
    }
    if (url.pathname === "/legacy") {
      url.pathname = "/";
      return original.fetch(new Request(url, request), env);
    }
    return original.fetch(request, env);
  },
};
