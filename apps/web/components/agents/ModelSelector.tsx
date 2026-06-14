"use client";

import { useEffect, useState } from "react";

const CUSTOM_SENTINEL = "__custom__";

interface ModelSelectorProps {
  /** Curated list from the backend for the current provider. */
  models: string[];
  /** Current model value (empty string = "use provider default"). */
  value: string;
  onChange: (v: string) => void;
  /** Shown as placeholder in both select and text input. */
  placeholder: string;
  className?: string;
}

/**
 * Dropdown listing curated models for the selected provider, plus a
 * "Personnalisé…" option that reveals a free-text input.
 *
 * Rules:
 *  - Empty value   → select stays on the "(défaut)" option.
 *  - Value in list → select shows that option.
 *  - Value not in list (loaded from DB) → starts in custom input mode.
 *  - When provider changes and models list is replaced, resets to select
 *    mode (keeps value only if it appears in the new list, else clears).
 */
export function ModelSelector({
  models,
  value,
  onChange,
  placeholder,
  className = "",
}: ModelSelectorProps) {
  // "custom" mode = free text input is visible
  const [custom, setCustom] = useState<boolean>(
    () => value !== "" && !models.includes(value),
  );

  // When the provider changes (models list identity changes), re-evaluate mode.
  // If the current value no longer exists in the new list → clear + select mode.
  useEffect(() => {
    if (value !== "" && !models.includes(value) && !custom) {
      // value was in old list but not new one → clear it
      onChange("");
    }
    // If we were in custom mode and value is empty (provider just changed),
    // flip back to select mode.
    if (custom && value === "") {
      setCustom(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [models]);

  function handleSelectChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const v = e.target.value;
    if (v === CUSTOM_SENTINEL) {
      setCustom(true);
      onChange("");
    } else {
      setCustom(false);
      // "" = default option chosen
      onChange(v);
    }
  }

  function handleProviderReset() {
    setCustom(false);
    onChange("");
  }

  const selectValue = custom
    ? CUSTOM_SENTINEL
    : value === "" || models.includes(value)
      ? value
      : CUSTOM_SENTINEL;

  if (custom) {
    return (
      <div className="flex flex-col gap-1.5">
        <div className="flex gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => onChange(e.target.value)}
            placeholder={placeholder}
            autoFocus
            className={className}
          />
          <button
            type="button"
            onClick={handleProviderReset}
            title="Revenir à la liste"
            className="flex-none rounded-[7px] border border-line bg-bg-2 px-2.5 text-[11.5px] text-text3 transition-colors hover:text-text"
          >
            Liste
          </button>
        </div>
        <span className="text-[10.5px] text-text3">
          Identifiant exact du modèle (ex.&nbsp;claude-opus-4-8)
        </span>
      </div>
    );
  }

  return (
    <select
      value={selectValue}
      onChange={handleSelectChange}
      className={className}
    >
      <option value="">{placeholder}</option>
      {models.map((m) => (
        <option key={m} value={m}>
          {m}
        </option>
      ))}
      <option value={CUSTOM_SENTINEL}>Personnalisé…</option>
    </select>
  );
}
