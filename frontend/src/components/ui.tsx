import type { ComponentProps, ReactNode } from "react";

export function cn(...values: Array<string | false | null | undefined>): string {
  return values.filter(Boolean).join(" ");
}

export function Card({
  className,
  children,
  ...props
}: ComponentProps<"section"> & { children: ReactNode }) {
  return (
    <section
      className={cn(
        "rounded-[var(--radius-panel)] border border-line bg-panel/80 backdrop-blur-sm",
        className,
      )}
      {...props}
    >
      {children}
    </section>
  );
}

export function CardHeader({
  title,
  description,
  actions,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
      <div>
        <h2 className="text-sm font-semibold tracking-wide text-ink uppercase">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {actions}
    </div>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = "default",
}: {
  label: ReactNode;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "accent" | "warn" | "danger";
}) {
  const toneClass =
    tone === "accent"
      ? "text-accent"
      : tone === "warn"
        ? "text-warn"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";

  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium tracking-wider text-faint uppercase">{label}</span>
      <span className={cn("tabular text-2xl leading-tight font-semibold", toneClass)}>{value}</span>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "accent" | "warn" | "danger" | "info";
}) {
  const toneClass = {
    neutral: "border-line-strong text-muted",
    accent: "border-accent/40 bg-accent-dim text-accent",
    warn: "border-warn/40 bg-warn-dim text-warn",
    danger: "border-danger/40 bg-danger-dim text-danger",
    info: "border-info/40 bg-info/10 text-info",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium tracking-wide",
        toneClass,
      )}
    >
      {children}
    </span>
  );
}

type ButtonProps = ComponentProps<"button"> & {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
};

const BUTTON_VARIANTS: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary:
    "bg-accent text-[#04120c] hover:bg-accent/90 disabled:bg-accent/30 disabled:text-[#04120c]/60",
  secondary:
    "border border-line-strong bg-panel-2 text-ink hover:border-accent/50 hover:text-accent disabled:opacity-40",
  ghost: "text-muted hover:text-ink disabled:opacity-40",
  danger: "bg-danger text-[#20070c] hover:bg-danger/90 disabled:bg-danger/30",
};

export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  return (
    <button
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed",
        size === "sm" ? "px-3 py-1.5 text-xs" : "px-4 py-2.5 text-sm",
        BUTTON_VARIANTS[variant],
        className,
      )}
      {...props}
    />
  );
}

export function AmountInput({
  id,
  label,
  value,
  onChange,
  symbol,
  max,
  onMax,
  disabled,
  hint,
  placeholder = "0.0",
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  symbol: string;
  max?: string;
  onMax?: () => void;
  disabled?: boolean;
  hint?: ReactNode;
  placeholder?: string;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-xs font-medium tracking-wider text-faint uppercase">
          {label}
        </label>
        {max ? <span className="text-xs text-muted">Max {max}</span> : null}
      </div>
      <div
        className={cn(
          "flex items-center gap-2 rounded-lg border border-line bg-base/60 px-3 py-2.5",
          "focus-within:border-accent/60",
          disabled && "opacity-60",
        )}
      >
        <input
          id={id}
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          placeholder={placeholder}
          disabled={disabled}
          className="tabular w-full bg-transparent text-lg text-ink outline-none placeholder:text-faint/60"
        />
        <span className="shrink-0 text-sm text-muted">{symbol}</span>
        {onMax ? (
          <button
            type="button"
            onClick={onMax}
            disabled={disabled}
            className="shrink-0 rounded-md border border-line-strong px-2 py-1 text-[11px] font-semibold tracking-wide text-muted uppercase hover:border-accent/50 hover:text-accent disabled:opacity-40"
          >
            Max
          </button>
        ) : null}
      </div>
      {hint ? <span className="text-xs text-muted">{hint}</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded-md bg-panel-2", className)} />;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
}: {
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T;
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div
      role="tablist"
      aria-label={label}
      className="inline-flex rounded-lg border border-line bg-base/50 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            "rounded-md px-3 py-1.5 text-xs font-medium transition-colors",
            value === option.value
              ? "bg-panel-2 text-ink shadow-sm"
              : "text-muted hover:text-ink",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="text-sm font-medium text-ink">{title}</p>
      {children ? <div className="max-w-md text-sm text-muted">{children}</div> : null}
    </div>
  );
}

export function Notice({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warn" | "danger" | "accent";
  title: ReactNode;
  children?: ReactNode;
}) {
  const toneClass = {
    info: "border-info/30 bg-info/5 text-info",
    warn: "border-warn/30 bg-warn/5 text-warn",
    danger: "border-danger/30 bg-danger/5 text-danger",
    accent: "border-accent/30 bg-accent/5 text-accent",
  }[tone];

  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", toneClass)}>
      <p className="font-medium">{title}</p>
      {children ? <div className="mt-1 text-muted">{children}</div> : null}
    </div>
  );
}
