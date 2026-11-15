import { ArrowSquareOut } from "@phosphor-icons/react";

export default function FriendSiteLink() {
  return (
    <a className="friend-site-link" href="https://yiyangcet.xyz/" target="_blank" rel="noopener noreferrer">
      <span>友站：<strong>译洋</strong></span>
      <ArrowSquareOut size={14} aria-hidden="true" />
    </a>
  );
}
