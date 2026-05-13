import { useState } from 'react';

interface Props {
  onConfirm: (name: string) => void;
  existing?: string;
}

export default function UserSetup({ onConfirm, existing }: Props) {
  const [name, setName] = useState(existing ?? '');
  const [error, setError] = useState('');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) { setError('Please enter your name.'); return; }
    onConfirm(name.trim());
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-white">
      <div className="w-full max-w-sm px-8">
        {/* Wordmark */}
        <div className="mb-10">
          <span className="text-3xl tracking-tight leading-none">
            <span className="font-light text-[#1A1A1A]">Health</span>
            <span className="font-bold text-[#1A1A1A]">Cap</span>
          </span>
          <p className="text-sm text-gray-400 mt-1">Dealflow Manager</p>
        </div>

        <form onSubmit={handleSubmit}>
          <h2 className="text-lg font-semibold text-[#1A1A1A] mb-1">
            {existing ? 'Change name' : 'Welcome'}
          </h2>
          <p className="text-sm text-gray-500 mb-6">
            {existing
              ? 'Update the name that will appear on your notes.'
              : 'Enter your name to continue. It will be recorded on any notes you create.'}
          </p>

          <label className="block text-xs font-medium text-gray-600 mb-1 uppercase tracking-wide">
            Your name
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => { setName(e.target.value); setError(''); }}
            placeholder="e.g. Anna Nilsson"
            autoFocus
            className="w-full border border-gray-300 px-3 py-2.5 text-sm focus:outline-none focus:border-[#005B6E] focus:ring-1 focus:ring-[#005B6E] mb-1"
            style={{ borderRadius: 2 }}
          />
          {error && <p className="text-xs text-red-500 mb-3">{error}</p>}

          <button
            type="submit"
            className="mt-4 w-full bg-[#005B6E] hover:bg-[#004A58] text-white py-2.5 text-sm font-medium transition-colors"
            style={{ borderRadius: 2 }}
          >
            Continue
          </button>
        </form>
      </div>
    </div>
  );
}
