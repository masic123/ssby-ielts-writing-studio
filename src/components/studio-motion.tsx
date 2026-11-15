"use client";

import { memo, useEffect, useRef, type RefObject } from "react";

const selector = [".home-intro-row", ".practice-toolbar", ".question-panel", ".editor-panel", ".bank-intro-row", ".bank-search", ".bank-mode-nav", ".question-card", ".history-row", ".method-intro", ".method-library > article", ".teacher-heading", ".teacher-welcome", ".report-header", ".score-overview", ".report-section"].join(",");

/** One-shot reveals only. The editor and its React identity never change. */
function StudioMotion({ root, scene, questionKey }: { root: RefObject<HTMLDivElement | null>; scene: string; questionKey: string }) {
  const lastQuestion = useRef(questionKey);
  useEffect(() => {
    const shell = root.current;
    if (!shell || !window.IntersectionObserver || !Element.prototype.animate) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    const narrow = window.matchMedia("(max-width: 767px)");
    const seen = new WeakSet<Element>();
    const animations = new Set<Animation>();
    let disposed = false;
    function cancel() { animations.forEach(animation => animation.cancel()); animations.clear(); }
    function show(element: HTMLElement, index: number) {
      if (disposed || reduce.matches || element.closest("[hidden]")) return;
      const animation = element.animate([
        { opacity: .15, transform: `translateY(${narrow.matches ? 10 : 14}px)` },
        { opacity: 1, transform: "translateY(0)" },
      ], { duration: narrow.matches ? 360 : 460, delay: Math.min(index, 3) * 35, easing: "cubic-bezier(.2,.75,.25,1)" });
      animations.add(animation);
      const release = () => { animations.delete(animation); };
      animation.onfinish = release;
      animation.oncancel = release;
    }
    const observer = new IntersectionObserver(entries => {
      let index = 0;
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        observer.unobserve(entry.target);
        show(entry.target as HTMLElement, index++);
      }
    }, { threshold: .04 });
    function register(node: Element) {
      const elements = [...(node.matches(selector) ? [node] : []), ...node.querySelectorAll(selector)];
      elements.forEach(element => { if (!seen.has(element)) { seen.add(element); observer.observe(element); } });
    }
    register(shell);
    const mutations = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) if (node instanceof Element) register(node);
    });
    mutations.observe(shell, { childList: true, subtree: true });
    reduce.addEventListener("change", cancel);
    return () => { disposed = true; observer.disconnect(); mutations.disconnect(); reduce.removeEventListener("change", cancel); cancel(); };
  }, [root, scene]);

  useEffect(() => {
    if (lastQuestion.current === questionKey) return;
    lastQuestion.current = questionKey;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || !Element.prototype.animate) return;
    const animations = Array.from(root.current?.querySelectorAll<HTMLElement>(".question-stem,.question-images") || []).map(element => element.animate([
      { opacity: .2, transform: "translateX(8px)" }, { opacity: 1, transform: "translateX(0)" },
    ], { duration: 280, easing: "cubic-bezier(.2,.75,.25,1)" }));
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const cancel = () => animations.forEach(animation => animation.cancel());
    preference.addEventListener("change", cancel);
    return () => { preference.removeEventListener("change", cancel); cancel(); };
  }, [root, questionKey]);
  return null;
}

export default memo(StudioMotion);
