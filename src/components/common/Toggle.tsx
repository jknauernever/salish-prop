interface ToggleProps {
  enabled: boolean;
  onChange: () => void;
  disabled?: boolean;
}

export function Toggle({ enabled, onChange, disabled }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onChange}
      className={`
        relative inline-flex h-5 w-9 shrink-0 cursor-pointer rounded-full
        transition-colors duration-200 ease-in-out
        focus:outline-none focus-visible:ring-2 focus-visible:ring-deep-teal focus-visible:ring-offset-2
        ${enabled ? 'bg-deep-teal' : 'bg-fog-gray-dark'}
        ${disabled ? 'opacity-40 cursor-not-allowed' : ''}
      `}
    >
      <span
        className={`
          pointer-events-none inline-block h-4 w-4 rounded-full bg-white shadow-sm
          ring-0 transition-transform duration-200 ease-in-out mt-0.5
          ${enabled ? 'translate-x-4 ml-0.5' : 'translate-x-0 ml-0.5'}
        `}
      />
    </button>
  );
}
