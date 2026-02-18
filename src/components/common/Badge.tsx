interface BadgeProps {
  count: number;
  variant?: 'default' | 'muted' | 'accent';
}

export function Badge({ count, variant = 'default' }: BadgeProps) {
  const styles = {
    default: 'bg-deep-teal/10 text-deep-teal',
    muted: 'bg-fog-gray-dark/50 text-slate-blue/60',
    accent: 'bg-driftwood/20 text-driftwood',
  };

  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${styles[variant]}`}>
      {count.toLocaleString()}
    </span>
  );
}
