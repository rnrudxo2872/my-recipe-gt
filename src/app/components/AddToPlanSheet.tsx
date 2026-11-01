import { useMutation, useQueryClient } from "@tanstack/react-query";
import { CalendarPlus } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router";
import { addDays, fromDay, MEAL_SLOTS, slotForNow, slotLabel, toDay, weekdayOf, type MealSlot } from "../../shared/fridge";
import { api } from "../lib/api";
import { useToast } from "../lib/toast";
import { AmountStepper } from "./AmountStepper";
import { Sheet } from "./Sheet";

export function dayLabel(day: string, today = toDay(new Date())): string {
  if (day === today) return "오늘";
  if (day === addDays(today, 1)) return "내일";
  if (day === addDays(today, -1)) return "어제";
  return weekdayOf(day);
}

/** '오늘', '내일', 그 밖에는 '11월 4일' */
export function whenText(day: string, today = toDay(new Date())): string {
  return day === today ? "오늘" : day === addDays(today, 1) ? "내일" : dateText(day);
}

export function dateText(day: string): string {
  const d = fromDay(day);
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

/** 오늘부터 2주 중 날짜 하나를 고르는 가로 띠 */
export function DayStrip(props: { value: string; onChange: (day: string) => void; days?: number }) {
  const today = toDay(new Date());
  const days = useMemo(() => Array.from({ length: props.days ?? 14 }, (_, i) => addDays(today, i)), [today, props.days]);
  return (
    <div className="day-strip" role="radiogroup" aria-label="날짜">
      {days.map((d) => (
        <button key={d} type="button" role="radio" aria-checked={d === props.value} className="day-chip" onClick={() => props.onChange(d)}>
          <span>{dayLabel(d, today)}</span>
          <b className="num">{fromDay(d).getDate()}</b>
        </button>
      ))}
    </div>
  );
}

export function SlotChips(props: { value: MealSlot; onChange: (slot: MealSlot) => void }) {
  return (
    <div className="chips" role="radiogroup" aria-label="끼니">
      {MEAL_SLOTS.map((s) => (
        <button key={s.slot} type="button" className="chip" role="radio" aria-checked={s.slot === props.value} aria-pressed={s.slot === props.value} onClick={() => props.onChange(s.slot)}>
          {s.label}
        </button>
      ))}
    </div>
  );
}

/** 레시피 화면에서 '식단에 넣기' */
export function AddToPlanSheet(props: { open: boolean; onClose: () => void; recipe: { id: string; title: string; servings: number | null }; servings: number | null }) {
  const { open, onClose, recipe } = props;
  const toast = useToast();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [day, setDay] = useState(() => toDay(new Date()));
  const [slot, setSlot] = useState<MealSlot>(slotForNow);
  const [servings, setServings] = useState<number | null>(props.servings);

  useEffect(() => {
    if (open) {
      setDay(toDay(new Date()));
      setSlot(slotForNow());
      setServings(props.servings);
    }
  }, [open, props.servings]);

  const add = useMutation({
    mutationFn: () => api.addPlan({ day, slot, recipeId: recipe.id, servings }),
    onSuccess: (entry) => {
      qc.invalidateQueries({ queryKey: ["plan"] });
      qc.invalidateQueries({ queryKey: ["plan-needs"] });
      onClose();
      toast.show(`${dateText(entry.day)} ${slotLabel(entry.slot)}에 넣었어요.`, {
        action: { label: "식단 보기", onClick: () => navigate(`/plan?day=${entry.day}`) },
      });
    },
    onError: (e) => toast.error(e),
  });

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="식단에 넣기"
      footer={
        <button type="button" className="btn btn-primary btn-block" disabled={add.isPending} onClick={() => add.mutate()}>
          <CalendarPlus aria-hidden="true" />
          {add.isPending ? "넣는 중…" : `${whenText(day)} ${slotLabel(slot)}에 넣기`}
        </button>
      }
    >
      <p className="sheet-lead">{recipe.title}, 언제 먹을까요?</p>
      <p className="label sheet-label">날짜</p>
      <DayStrip value={day} onChange={setDay} />
      <p className="label sheet-label">끼니</p>
      <SlotChips value={slot} onChange={setSlot} />
      {servings != null && (
        <>
          <p className="label sheet-label">몇 인분</p>
          <AmountStepper value={servings} unit="인분" step={1} min={1} max={20} label="인분" onChange={setServings} />
        </>
      )}
    </Sheet>
  );
}
