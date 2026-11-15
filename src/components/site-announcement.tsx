"use client";
import { useEffect, useState } from "react";
import { Modal } from "./ui";
import "./site-announcement.css";
const key = "writing:developer-announcement:20261102-vip-modal";
let seenThisSession = false;
export default function SiteAnnouncement({ open, onOpenChange, blocked, onMembership }: {
  open: boolean; onOpenChange: (value: boolean) => void; blocked: boolean; onMembership: () => void;
}) {
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => {
    let seen = seenThisSession;
    try { seen = seen || localStorage.getItem(key) === "seen"; } catch {}
    setAutoOpen(!seen);
    const seenElsewhere = (event: StorageEvent) => {
      if (event.key === key && event.newValue === "seen") { seenThisSession = true; setAutoOpen(false); }
    };
    window.addEventListener("storage", seenElsewhere);
    return () => window.removeEventListener("storage", seenElsewhere);
  }, []);
  function dismiss() {
    seenThisSession = true;
    setAutoOpen(false);
    try { localStorage.setItem(key, "seen"); } catch {}
    onOpenChange(false);
  }
  return <Modal open={(open || autoOpen) && !blocked} onOpenChange={value => { if (!value) dismiss(); else onOpenChange(true); }} title="开发者来信：订阅制度与早期用户赠礼">
      <article className="developer-announcement">
        <p className="announcement-date">2026年11月1日 · 开发者本人</p>
        <p>大家好，我是本站的开发者。</p>
        <p>感谢各位选择使用本站。没想到会有这么多人注册、使用，也很高兴这个网站能帮助大家练习写作与翻译。</p>
        <p>随着使用人数增加，后台模型调用的Token消耗和服务器占用也在不断增长。再加上开发、维护投入的时间与资金，长期依靠站长个人承担这些开销，确实难以持续。</p>
        <p>为了让本站能够长期、稳定地运营和维护，我们将从北京时间<strong>2026年11月2日00:00</strong>起推出订阅制度。本站的初衷始终是帮助大家更高效、更便捷地提升写作与翻译成绩，因此会员价格也远低于市场价格。</p>
        <p className="announcement-gift">为了感谢早期用户的支持，所有在北京时间<strong>2026年11月2日00:00前</strong>注册的普通账号，注册赠礼合计为<strong>5天VIP</strong>，不重复叠加此前的注册赠礼。已有更长会员时长或永久VIP的账号保留原有权益；专属邀请码按对应权益发放，不与普通注册赠礼叠加。</p>
        <p>北京时间<strong>2026年11月2日00:00起</strong>，新注册的普通账号赠送<strong>1天VIP</strong>。</p>
        <p>接下来，我会继续听取大家的需求，开发更多实用功能，做好日常运营与维护，努力把服务做好。</p>
        <p>感谢大家的理解与支持！</p>
        <div className="announcement-actions">
          <button type="button" className="button primary" onClick={dismiss}>我知道了</button>
          <button type="button" className="button secondary" onClick={() => { dismiss(); onMembership(); }}>查看会员规则</button>
        </div>
      </article>
    </Modal>;
}
