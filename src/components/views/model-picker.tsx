"use client";

import { useEffect, useMemo, useState } from "react";
import type { ProviderId } from "@/lib/shared/types";
import { modelIdsForProvider } from "@/lib/shared/models";

interface OpenCodeModel {
  apiId: string;
  provider: string;
  label: string;
}

interface Props {
  provider: ProviderId;
  model: string;
  onModel: (m: string) => void;
}

// Provider-aware model selector. Small static catalogs (claude/codex/grok)
// render as segmented buttons. opencode routes to a large, dynamic, plan-dependent
// list, so it gets a search-filtered combobox fed by /api/providers/opencode/models.
export function ModelPicker({ provider, model, onModel }: Props) {
  if (provider === "opencode") {
    return <OpenCodePicker model={model} onModel={onModel} />;
  }
  const ids = modelIdsForProvider(provider);
  return (
    <div className="model-segment" role="radiogroup" aria-label="Model">
      {ids.map((m) => (
        <button
          key={m}
          type="button"
          role="radio"
          aria-checked={model === m}
          className={model === m ? "on" : ""}
          onClick={() => onModel(m)}
        >{m}</button>
      ))}
    </div>
  );
}

function OpenCodePicker({ model, onModel }: { model: string; onModel: (m: string) => void }) {
  const [models, setModels] = useState<OpenCodeModel[] | null>(null);
  const [query, setQuery] = useState("");

  useEffect(() => {
    const ac = new AbortController();
    void (async () => {
      try {
        const res = await fetch("/api/providers/opencode/models", { cache: "no-store", signal: ac.signal });
        if (!res.ok) return;
        const j = (await res.json()) as { models: OpenCodeModel[] };
        setModels(j.models);
      } catch { /* aborted / offline: keep fallback */ }
    })();
    return () => ac.abort();
  }, []);

  // Fallback to the static catalog ids until discovery returns.
  const list = useMemo<OpenCodeModel[]>(() => {
    if (models && models.length) return models;
    return modelIdsForProvider("opencode").map((id) => {
      const slash = id.indexOf("/");
      return { apiId: id, provider: slash > 0 ? id.slice(0, slash) : "opencode", label: slash > 0 ? id.slice(slash + 1) : id };
    });
  }, [models]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return list;
    return list.filter((m) => m.apiId.toLowerCase().includes(q));
  }, [list, query]);

  return (
    <div className="oc-model-picker">
      <input
        type="text"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder={`Search ${list.length} model${list.length === 1 ? "" : "s"}…`}
        aria-label="Search opencode models"
        className="oc-model-search"
      />
      <div className="oc-model-list" role="radiogroup" aria-label="Model">
        {filtered.length === 0 && <div className="oc-model-empty">no model matches “{query}”</div>}
        {filtered.map((m) => (
          <button
            key={m.apiId}
            type="button"
            role="radio"
            aria-checked={model === m.apiId}
            className={`oc-model-row ${model === m.apiId ? "on" : ""}`}
            onClick={() => onModel(m.apiId)}
            title={m.apiId}
          >
            <span className="oc-model-name">{m.label}</span>
            <span className="oc-model-provider">{m.provider}</span>
          </button>
        ))}
      </div>
      <div className="oc-model-selected">selected: <code>{model}</code></div>
    </div>
  );
}
