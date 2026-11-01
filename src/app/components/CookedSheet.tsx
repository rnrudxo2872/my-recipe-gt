import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Refrigerator } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { afterUse, formatStock, planCooking, stepFor } from "../../shared/fridge";
import { formatQty, type RecipeDetail } from "../../shared/recipe";
import { api } from "../lib/api";
import { fridgeName, useFridge, useSetFridge } from "../lib/fridge";
import { useToast } from "../lib/toast";
import { AmountStepper } from "./AmountStepper";
import { Sheet } from "./Sheet";

interface Row {
  on: boolean;
  amount: number;
}

/**
 * 요리를 마쳤을 때: 레시피에 쓴 만큼 냉장고에서 뺀다.
 * 양을 아는 재료는 미리 체크해 두고, 양을 모르는 재료는 '다 썼어요'를 골랐을 때만 뺀다.
 */
export function CookedSheet(props: {
  open: boolean;
  onClose: () => void;
  recipe: RecipeDetail | undefined;
  factor: number;
  /** 식단에서 왔으면 그 끼니를 '만들었음'으로 표시한다 */
  planId?: string;
  onDone?: () => void;
}) {
  const { open, onClose, recipe, factor, planId, onDone } = props;
  const fridge = useFridge();
  const setFridge = useSetFridge();
  const toast = useToast();
  const qc = useQueryClient();
  const plans = useMemo(
    () => (recipe && fridge.data ? planCooking(recipe.content.ingredients, factor, fridge.data.items) : []),
    [recipe, factor, fridge.data],
  );
  const [rows, setRows] = useState<Record<string, Row>>({});
  const ready = useRef(false);

  // 열 때 한 번만 채운다(냉장고를 다시 받아도 고친 양이 그대로 남게).
  useEffect(() => {
    if (!open) {
      ready.current = false;
      return;
    }
    if (ready.current || !fridge.data || !recipe) return;
    ready.current = true;
    setRows(Object.fromEntries(plans.map((p) => [p.itemId, { on: p.use != null && p.use > 0, amount: p.use ?? 0 }])));
  }, [open, plans, fridge.data, recipe]);

  const finish = useMutation({
    mutationFn: async (deduct: boolean) => {
      const uses = deduct
        ? plans
            .filter((p) => rows[p.itemId]?.on)
            .map((p) => {
              const r = rows[p.itemId];
              return p.before == null ? { itemId: p.itemId, all: true } : { itemId: p.itemId, use: r.amount };
            })
            .filter((u) => "all" in u || (u.use ?? 0) > 0)
        : [];
      return api.cooked(uses, planId);
    },
    onSuccess: ({ before, state }) => {
      setFridge(state);
      if (planId) qc.invalidateQueries({ queryKey: ["plan"] });
      onDone?.();
      onClose();
      if (before.length) {
        toast.show(`냉장고에서 ${before.length}가지를 정리했어요.`, {
          action: {
            label: "되돌리기",
            onClick: () => {
              api
                .restoreItems(before)
                .then((s) => {
                  setFridge(s);
                  toast.show("냉장고를 되돌렸어요.");
                })
                .catch((e) => toast.error(e));
            },
          },
        });
      } else if (planId) {
        toast.show("만든 걸로 표시했어요.");
      }
    },
    onError: (e) => toast.error(e),
  });

  const chosen = plans.filter((p) => rows[p.itemId]?.on).length;
  const set = (id: string, patch: Partial<Row>) => setRows((r) => ({ ...r, [id]: { ...r[id], ...patch } }));

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="냉장고에서 뺄게요"
      footer={
        plans.length ? (
          <div className="btn-row">
            <button type="button" className="btn btn-quiet" disabled={finish.isPending} onClick={() => finish.mutate(false)}>
              빼지 않고 끝내기
            </button>
            <button type="button" className="btn btn-primary" disabled={finish.isPending || chosen === 0} onClick={() => finish.mutate(true)}>
              <Refrigerator aria-hidden="true" />
              {finish.isPending ? "정리하는 중…" : `${chosen}가지 빼기`}
            </button>
          </div>
        ) : (
          <button type="button" className="btn btn-primary btn-block" disabled={finish.isPending} onClick={() => finish.mutate(false)}>
            <Check aria-hidden="true" />
            끝내기
          </button>
        )
      }
    >
      {fridge.isPending || !recipe ? (
        <div className="skeleton" style={{ height: 160 }} />
      ) : plans.length === 0 ? (
        <p className="sheet-lead">이 요리에 쓰는 재료가 냉장고에 없어요. 그대로 끝낼게요.</p>
      ) : (
        <>
          <p className="sheet-lead">
            {recipe.content.servings ? `${formatQty((recipe.content.servings ?? 1) * factor)}인분 ` : ""}레시피에 적힌 만큼이에요. 쓴 양이 다르면 고쳐 주세요.
          </p>
          <ul className="use-list">
            {plans.map((p) => {
              const r = rows[p.itemId] ?? { on: false, amount: 0 };
              const left = p.before != null && r.on ? afterUse(p.before, r.amount) : p.before;
              const status =
                p.before == null
                  ? r.on
                    ? "다 써서 냉장고에서 빠져요"
                    : "양을 몰라요. 다 썼으면 체크해 주세요"
                  : !r.on
                    ? "그대로 둬요"
                    : left == null
                      ? "다 써서 냉장고에서 빠져요"
                      : `${formatStock({ qty: left, unit: p.unit })} 남아요`;
              return (
                <li key={p.itemId} className={r.on ? "use-row is-on" : "use-row"}>
                  <label className="use-check">
                    <input
                      type="checkbox"
                      checked={r.on}
                      onChange={(e) => set(p.itemId, { on: e.target.checked, amount: e.target.checked && r.amount === 0 && p.before != null ? (p.use ?? p.before) : r.amount })}
                    />
                    <span className="use-info">
                      <span className="use-name">
                        {p.itemName}
                        <span className="use-where">{fridgeName(fridge.data, p.fridgeId)}</span>
                      </span>
                      <span className="use-sub">
                        {p.need && `레시피 ${p.need} · `}
                        {status}
                      </span>
                    </span>
                  </label>
                  {p.before != null && (
                    <AmountStepper
                      value={r.amount}
                      unit={p.unit}
                      step={stepFor(p.unit, p.before)}
                      max={p.before}
                      disabled={!r.on}
                      label={`${p.itemName} 뺄 양`}
                      onChange={(amount) => set(p.itemId, { amount })}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Sheet>
  );
}
