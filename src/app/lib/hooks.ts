import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { api } from "./api";

export function useConfig() {
  return useQuery({ queryKey: ["config"], queryFn: api.config, staleTime: Infinity });
}

export function useMe() {
  return useQuery({ queryKey: ["me"], queryFn: api.me, staleTime: 30_000 });
}

/** 로그인한 사용자. 로그인 화면 밖에서만 쓰므로 항상 있다고 본다. */
export function useUser() {
  const { data } = useMe();
  return data!;
}

export function useRecipes() {
  return useQuery({ queryKey: ["recipes"], queryFn: api.recipes, staleTime: 15_000 });
}

export function useRecipe(id: string | undefined) {
  return useQuery({ queryKey: ["recipe", id], queryFn: () => api.recipe(id!), enabled: Boolean(id) });
}

/** 목록에서 이미 받은 요약(제목·사진)을 상세 화면이 뜨기 전에 보여 주려고 꺼낸다. */
export function useRecipeSummary(id: string | undefined) {
  const qc = useQueryClient();
  return qc.getQueryData<Awaited<ReturnType<typeof api.recipes>>>(["recipes"])?.find((r) => r.id === id);
}

export function useOnline() {
  const [online, setOnline] = useState(typeof navigator === "undefined" ? true : navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener("online", on);
    window.addEventListener("offline", off);
    return () => {
      window.removeEventListener("online", on);
      window.removeEventListener("offline", off);
    };
  }, []);
  return online;
}

export function useDocumentTitle(title: string | undefined) {
  useEffect(() => {
    document.title = title ? `${title} | 레시피GT` : "레시피GT";
  }, [title]);
}
