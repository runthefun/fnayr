type Props = {
  value: string;
  onChange: (value: string) => void;
};

export function StringField({ value, onChange }: Props) {
  return (
    <input
      type="text"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-input border border-subtle rounded px-1.5 py-1 w-full text-primary outline-none focus:border-focus hover:border-border text-body"
    />
  );
}
