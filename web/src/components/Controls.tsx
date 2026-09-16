export function Panel({ title, subtitle, children, action }: { title: string; subtitle?: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="glass rounded-[var(--radius-panel)] p-6">
      <div className="mb-5 flex items-start justify-between gap-4">
        <div>
          <h2 className="text-[15px] font-semibold tracking-tight">{title}</h2>
          {subtitle && <p className="mt-1 text-[12.5px] leading-relaxed text-mist-500">{subtitle}</p>}
        </div>
        {action}
      </div>
      <div className="space-y-4">{children}</div>
    </section>
  );
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-6 border-b border-white/5 pb-4 last:border-0 last:pb-0">
      <div className="min-w-0">
        <div className="text-[13.5px]">{label}</div>
        {hint && <div className="mt-0.5 text-[12px] leading-relaxed text-mist-600">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

export function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative h-6 w-11 rounded-full transition-colors duration-200 ${checked ? 'bg-accent' : 'bg-white/15'}`}
    >
      <span
        className="absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform duration-[280ms] ease-[var(--ease-spring)]"
        style={{ transform: checked ? 'translateX(20px)' : 'none' }}
      />
    </button>
  );
}

export function Select<T extends string | number>({
  value,
  onChange,
  options,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string }[];
}) {
  return (
    <select
      value={value}
      onChange={(e) => onChange((typeof value === 'number' ? Number(e.target.value) : e.target.value) as T)}
      className="min-w-36 rounded-xl border border-white/8 bg-white/6 px-3 py-1.5 text-[13px] text-mist-200 outline-none transition-colors hover:bg-white/10 focus:border-accent/40"
    >
      {options.map((o) => (
        <option key={String(o.value)} value={o.value} className="bg-ink-800">
          {o.label}
        </option>
      ))}
    </select>
  );
}

export function Slider({
  value,
  min,
  max,
  step = 1,
  suffix,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step?: number;
  suffix?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex items-center gap-3">
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-40 accent-accent"
      />
      <span className="w-14 text-right font-mono text-[12px] text-mist-400 tabular-nums">
        {value}
        {suffix}
      </span>
    </div>
  );
}

export function Button({
  children,
  onClick,
  disabled,
  variant = 'primary',
}: {
  children: React.ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const styles = {
    primary: 'bg-mist-100 text-ink-950 hover:bg-white',
    ghost: 'bg-white/8 text-mist-200 hover:bg-white/14',
    danger: 'bg-red-500/15 text-red-300 hover:bg-red-500/25',
  }[variant];
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`rounded-full px-4 py-2 text-[13px] font-semibold transition-all duration-200 hover:scale-[1.03] active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${styles}`}
    >
      {children}
    </button>
  );
}

export function TextInput({
  value,
  onChange,
  placeholder,
  type = 'text',
  className = '',
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  type?: string;
  className?: string;
}) {
  return (
    <input
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      className={`rounded-xl border border-white/8 bg-white/6 px-3 py-2 text-[13px] outline-none transition-colors placeholder:text-mist-600 focus:border-accent/40 ${className}`}
    />
  );
}
