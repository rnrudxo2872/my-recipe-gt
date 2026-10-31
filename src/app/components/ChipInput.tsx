import { X } from "lucide-react";
import { useId, useMemo, useState } from "react";

/** 재료·태그를 하나씩 넣는 칸. 엔터나 쉼표로 추가하고, 자동완성 목록을 보여 준다. */
export function ChipInput(props: {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions?: string[];
  placeholder: string;
  label: string;
  max?: number;
}) {
  const { values, onChange, suggestions = [], max = 40 } = props;
  const [text, setText] = useState("");
  // -1이면 자동완성에서 고른 것이 없다(엔터는 입력한 글자를 넣는다).
  const [active, setActive] = useState(-1);
  const listId = useId();

  const matches = useMemo(() => {
    const q = text.trim();
    if (!q) return [];
    return suggestions.filter((s) => s.includes(q) && !values.includes(s)).slice(0, 8);
  }, [text, suggestions, values]);

  function add(raw: string) {
    const parts = raw
      .split(/[,，\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    if (!parts.length) return;
    const next = [...values];
    for (const p of parts) if (!next.includes(p) && next.length < max) next.push(p.slice(0, 30));
    onChange(next);
    setText("");
    setActive(-1);
  }

  return (
    <div>
      <div className="pantry-input">
        <input
          className="input"
          value={text}
          placeholder={props.placeholder}
          aria-label={props.label}
          role="combobox"
          aria-expanded={matches.length > 0}
          aria-controls={listId}
          aria-autocomplete="list"
          enterKeyHint="enter"
          onChange={(e) => {
            const v = e.target.value;
            if (/[,，]/.test(v)) add(v);
            else {
              setText(v);
              setActive(-1);
            }
          }}
          onKeyDown={(e) => {
            if (e.nativeEvent.isComposing) return;
            if (e.key === "Enter") {
              e.preventDefault();
              add(active >= 0 && matches[active] ? matches[active] : text);
            } else if (e.key === "ArrowDown" && matches.length) {
              e.preventDefault();
              setActive((a) => Math.min(matches.length - 1, a + 1));
            } else if (e.key === "ArrowUp" && matches.length) {
              e.preventDefault();
              setActive((a) => Math.max(-1, a - 1));
            } else if (e.key === "Backspace" && !text && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
        />
        {matches.length > 0 && (
          <ul className="suggest" id={listId} role="listbox">
            {matches.map((m, i) => (
              <li key={m} role="option" aria-selected={i === active}>
                <button type="button" className={i === active ? "is-active" : ""} onMouseDown={(e) => e.preventDefault()} onClick={() => add(m)}>
                  {m}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {values.length > 0 && (
        <div className="chips pantry-chips">
          {values.map((v) => (
            <span key={v} className="chip is-food">
              {v}
              <button type="button" className="chip-x" aria-label={`${v} 빼기`} onClick={() => onChange(values.filter((x) => x !== v))}>
                <X />
              </button>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
