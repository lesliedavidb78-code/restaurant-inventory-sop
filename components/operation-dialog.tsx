"use client";
import { useEffect, useRef, useState, type ReactNode } from "react";

export function OperationDialog({ title, children, onClose }: { title: string; children: ReactNode; onClose: () => void }) {
  const box = useRef<HTMLDivElement>(null); const close = useRef(onClose); close.current = onClose;
  useEffect(() => { const previous = document.activeElement as HTMLElement | null; box.current?.querySelector<HTMLElement>("button,input")?.focus(); return () => previous?.focus(); }, []);
  return <div className="inventory-modal-backdrop"><div ref={box} role="dialog" aria-modal="true" aria-label={title} className="inventory-modal cleanup-choice" onKeyDown={(e) => {
    if (e.key === "Escape") { e.preventDefault(); close.current(); }
    if (e.key === "Tab") { const elements = Array.from(box.current?.querySelectorAll<HTMLElement>("button:not(:disabled),input:not(:disabled),[tabindex='0']") ?? []); const first=elements[0],last=elements.at(-1); if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last?.focus(); } else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first?.focus(); } }
  }}><h3>{title}</h3>{children}</div></div>;
}

export function useConfirmation() {
  const [question, setQuestion] = useState(""); const pending = useRef<((answer: boolean) => void) | null>(null);
  useEffect(() => () => { pending.current?.(false); }, []);
  const answer = (value: boolean) => { pending.current?.(value); pending.current=null; setQuestion(""); };
  const ask = (text: string) => new Promise<boolean>((resolve) => { pending.current?.(false); pending.current=resolve; setQuestion(text); });
  const dialog = question ? <OperationDialog title="请确认操作" onClose={() => answer(false)}><p>{question}</p><footer><button type="button" className="secondary" onClick={() => answer(false)}>取消</button><button type="button" className="primary" onClick={() => answer(true)}>确认继续</button></footer></OperationDialog> : null;
  return { ask, dialog };
}
