import { Trophy } from "lucide-react";

export function BrandLogo({ size = "md" }: { size?: "sm" | "md" | "lg" }) {
  const dims = size === "sm" ? "h-8 w-8" : size === "lg" ? "h-14 w-14" : "h-10 w-10";
  const text = size === "sm" ? "text-lg" : size === "lg" ? "text-3xl" : "text-xl";
  return (
    <div className="flex items-center gap-3">
      <div
        className={`${dims} grid place-items-center rounded-xl bg-gradient-to-br from-primary to-accent shadow-lg shadow-primary/20`}
      >
        <Trophy className="h-1/2 w-1/2 text-primary-foreground" strokeWidth={2.5} />
      </div>
      <div className="leading-tight">
        <div className={`${text} font-bold tracking-tight`}>
          Bolão<span className="text-accent">EEL</span>
        </div>
        {size !== "sm" && (
          <div className="text-[10px] uppercase tracking-widest text-muted-foreground">
            Luka Doncic Fan Club
          </div>
        )}
      </div>
    </div>
  );
}
