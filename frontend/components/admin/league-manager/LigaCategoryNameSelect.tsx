'use client';

interface LigaCategoryNameSelectProps {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  className?: string;
}

export default function LigaCategoryNameSelect({
  value,
  onChange,
  options,
  placeholder = 'Select category',
  className = 'w-full p-2 border border-input rounded bg-background text-foreground text-sm',
}: LigaCategoryNameSelectProps) {
  if (options.length === 0) {
    return (
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={className}
        placeholder={placeholder}
      />
    );
  }
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      <option value="">{placeholder}</option>
      {options.map((name) => (
        <option key={name} value={name}>{name}</option>
      ))}
      {value && !options.includes(value) && (
        <option value={value}>{value}</option>
      )}
    </select>
  );
}
