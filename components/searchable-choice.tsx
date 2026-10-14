"use client";
import { useId, useState } from "react";

type Option = { id: string; label: string; search?: string };
/** One input is both keyword search and selection. Stable IDs avoid same-name ambiguity. */
export function SearchableChoice({ options, value, onChange, placeholder, disabled }: { options: Option[]; value: string; onChange: (id: string) => void; placeholder: string; disabled?: boolean }) {
  const id = useId(); const [query, setQuery] = useState(""); const [open, setOpen] = useState(false); const [cursor, setCursor] = useState(0);
  const selected = options.find((o) => o.id === value);
  const matches = options.filter((o) => `${o.label} ${o.search ?? ""}`.toLowerCase().includes(query.trim().toLowerCase()));
  const choose = (option: Option) => { onChange(option.id); setQuery(""); setOpen(false); };
  return <div className="searchable-choice" style={{ position: "relative" }}>
    <input role="combobox" aria-label={placeholder} aria-expanded={open} aria-controls={id} aria-autocomplete="list" disabled={disabled} placeholder={placeholder} value={open ? query : selected?.label ?? query} onFocus={() => { setOpen(true); setQuery(""); }} onBlur={() => setOpen(false)} onChange={(e) => { setQuery(e.target.value); setCursor(0); setOpen(true); onChange(""); }} onKeyDown={(e) => { if (e.key === "ArrowDown") { e.preventDefault(); setOpen(true); setCursor((n) => Math.min(n + 1, matches.length - 1)); } else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((n) => Math.max(0, n - 1)); } else if (e.key === "Enter" && open) { e.preventDefault(); if (matches[cursor]) choose(matches[cursor]); } else if (e.key === "Escape") setOpen(false); }}/>
    {open && <div id={id} role="listbox" style={{ position: "absolute", zIndex: 30, background: "white", border: "1px solid #dbe4f0", width: "100%", maxHeight: 240, overflowY: "auto", boxShadow: "0 6px 16px #0002" }}>{matches.length ? matches.map((option, index) => <div role="option" aria-selected={option.id === value} key={option.id} onMouseDown={(e) => { e.preventDefault(); choose(option); }} style={{ padding: "10px 12px", cursor: "pointer", background: cursor === index ? "#eaf2ff" : "white" }}>{option.label}</div>) : <div style={{ padding: 12 }}>没有匹配项，请更换关键词。</div>}</div>}
  </div>;
}
