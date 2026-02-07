type Props = {
  value: boolean;
  onChange: (value: boolean) => void;
};

export function BooleanField({ value, onChange }: Props) {
  return (
    <label className="flex items-center gap-2 cursor-pointer">
      <input
        type="checkbox"
        checked={value}
        onChange={(e) => onChange(e.target.checked)}
        className="accent-accent"
      />
    </label>
  );
}
