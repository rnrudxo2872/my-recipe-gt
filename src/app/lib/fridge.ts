import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import type { FridgeState } from "../../shared/fridge";
import { api } from "./api";

export function useFridge() {
  return useQuery({ queryKey: ["fridge"], queryFn: api.fridge, staleTime: 30_000 });
}

/** 서버가 돌려준 냉장고 상태로 화면을 바로 바꾼다. 냉장고가 바뀌면 레시피 찾기 결과도 다시 받는다. */
export function useSetFridge() {
  const qc = useQueryClient();
  return useCallback(
    (state: FridgeState) => {
      qc.setQueryData(["fridge"], state);
      qc.invalidateQueries({ queryKey: ["match"] });
      qc.invalidateQueries({ queryKey: ["plan-needs"] });
    },
    [qc],
  );
}

/** 레시피 찾기에 쓸 재료 이름. fridgeIds를 주면 그 냉장고들만 */
export function pantryNames(state: FridgeState | undefined, fridgeIds?: Set<string>): string[] {
  if (!state) return [];
  const names = state.items.filter((i) => !fridgeIds || fridgeIds.has(i.fridgeId)).map((i) => i.name);
  return [...new Set(names)];
}

export function fridgeName(state: FridgeState | undefined, id: string): string {
  return state?.fridges.find((f) => f.id === id)?.name ?? "";
}
