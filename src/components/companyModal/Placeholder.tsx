interface PlaceholderProps {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
}

// Empty-state placeholder for views that are not built out yet.
export default function Placeholder({ icon, title, subtitle }: PlaceholderProps) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <div className="text-gray-200 mb-2">{icon}</div>
      <p className="text-sm text-gray-400">{title}</p>
      <p className="text-xs text-gray-300 mt-1">{subtitle}</p>
    </div>
  );
}
