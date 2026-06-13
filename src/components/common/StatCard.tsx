type Tone = "blue" | "emerald" | "amber" | "rose" | "slate";

const toneMap: Record<Tone, string> = {
  blue: "text-blue-600",
  emerald: "text-emerald-600",
  amber: "text-amber-600",
  rose: "text-rose-600",
  slate: "text-slate-600",
};

export default function StatCard({
  label,
  value,
  tone = "slate",
  onClick,
}: {
  label: string;
  value: string | number;
  tone?: Tone;
  onClick?: () => void;
}) {
  const Component = onClick ? "button" : "div";
  return (
    <Component
      onClick={onClick}
      className={`rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm ${
        onClick ? "cursor-pointer transition-all hover:shadow-md hover:border-slate-300 active:scale-[0.98]" : ""
      }`}
    >
      <div className="text-sm text-slate-600">{label}</div>
      <div className={`mt-1.5 text-xl font-semibold tabular-nums leading-tight ${toneMap[tone]}`}>
        {value}
      </div>
    </Component>
  );
}


