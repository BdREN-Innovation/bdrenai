function initials(name: string, email: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return (parts[0]?.[0] || email[0] || "?").toUpperCase();
}

export function Avatar({
  name,
  email,
  url,
  size = 36,
}: {
  name: string;
  email: string;
  url: string | null;
  size?: number;
}) {
  const style = { width: size, height: size, fontSize: Math.round(size * 0.4) };
  if (url) {
    return <img src={url} alt="" style={style} className="flex-none rounded-full object-cover" />;
  }
  return (
    <span
      aria-hidden="true"
      style={style}
      className="flex flex-none items-center justify-center rounded-full bg-brand font-semibold text-white"
    >
      {initials(name, email)}
    </span>
  );
}
