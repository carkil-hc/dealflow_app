import { useState } from 'react';
import { Send } from 'lucide-react';
import { NoteEntry, formatDateTime, userInitials, userColor } from '../types';

interface Props {
  notes: NoteEntry[];
  currentUser: string;
  onChange: (notes: NoteEntry[]) => void;
}

export default function NoteTimeline({ notes, currentUser, onChange }: Props) {
  const [draft, setDraft] = useState('');

  const sorted = [...notes].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  const handleAdd = () => {
    if (!draft.trim()) return;
    const entry: NoteEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      text: draft.trim(),
      createdAt: new Date().toISOString(),
      createdBy: currentUser,
    };
    onChange([...notes, entry]);
    setDraft('');
  };

  const handleKey = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleAdd();
  };

  const handleDelete = (id: string) => {
    onChange(notes.filter(n => n.id !== id));
  };

  return (
    <div className="flex flex-col gap-5">
      {/* Compose */}
      <div className="border border-gray-200 bg-white" style={{ borderRadius: 2 }}>
        <textarea
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={handleKey}
          placeholder="Add a note… (Ctrl+Enter to submit)"
          rows={3}
          className="w-full px-4 pt-3 pb-2 text-sm text-[#1A1A1A] placeholder-gray-400 focus:outline-none resize-none"
        />
        <div className="flex items-center justify-between px-4 pb-3">
          <span className="text-xs text-gray-400">Posting as <span className="font-medium text-[#1A1A1A]">{currentUser}</span></span>
          <button
            onClick={handleAdd}
            disabled={!draft.trim()}
            className="flex items-center gap-1.5 bg-[#005B6E] hover:bg-[#004A58] disabled:bg-gray-200 disabled:text-gray-400 text-white text-xs font-medium px-3 py-1.5 transition-colors"
            style={{ borderRadius: 2 }}
          >
            <Send className="w-3 h-3" />
            Add Note
          </button>
        </div>
      </div>

      {/* Timeline */}
      {sorted.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-8">No notes yet.</p>
      ) : (
        <div className="space-y-4">
          {sorted.map((note) => {
            const initials = userInitials(note.createdBy);
            const color = userColor(note.createdBy);
            const isOwn = note.createdBy === currentUser;
            return (
              <div key={note.id} className="flex gap-3 group">
                {/* Avatar */}
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-white text-[10px] font-bold shrink-0 mt-0.5"
                  style={{ backgroundColor: color }}
                >
                  {initials}
                </div>
                {/* Body */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2 mb-1">
                    <span className="text-xs font-semibold text-[#1A1A1A]">{note.createdBy}</span>
                    <span className="text-xs text-gray-400">{formatDateTime(note.createdAt)}</span>
                  </div>
                  <p className="text-sm text-[#1A1A1A] leading-relaxed whitespace-pre-wrap bg-white border border-gray-100 px-3 py-2" style={{ borderRadius: 2 }}>
                    {note.text}
                  </p>
                </div>
                {/* Delete (own notes only) */}
                {isOwn && (
                  <button
                    onClick={() => handleDelete(note.id)}
                    className="text-gray-300 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all text-xs mt-1 shrink-0"
                    title="Delete note"
                  >
                    ×
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
