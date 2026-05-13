import { useRef, useState } from 'react';
import { Upload, X, Download, FileText, File } from 'lucide-react';
import { Attachment, formatFileSize, formatDate } from '../types';
import { saveFile, deleteFile, downloadFile } from '../db';

interface Props {
  attachments: Attachment[];
  onChange: (attachments: Attachment[]) => void;
}

function fileIcon(type: string) {
  if (type === 'application/pdf') return <FileText className="w-4 h-4 text-red-400" />;
  if (type.startsWith('image/')) return <File className="w-4 h-4 text-blue-400" />;
  return <File className="w-4 h-4 text-gray-400" />;
}

export default function FileUpload({ attachments, onChange }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    const next = [...attachments];
    for (const file of Array.from(files)) {
      const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      await saveFile(id, file);
      next.push({ id, name: file.name, type: file.type, size: file.size, uploadedAt: new Date().toISOString() });
    }
    onChange(next);
    setUploading(false);
  };

  const handleRemove = async (id: string) => {
    await deleteFile(id);
    onChange(attachments.filter(a => a.id !== id));
  };

  return (
    <div className="space-y-4">
      <div
        onDragOver={e => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        className={`border-2 border-dashed px-8 py-10 text-center cursor-pointer transition-colors ${
          dragging ? 'border-[#005B6E] bg-[#E0F0F5]' : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
        }`} style={{ borderRadius: 2 }}
      >
        <Upload className={`w-7 h-7 mx-auto mb-2 ${dragging ? 'text-[#005B6E]' : 'text-gray-300'}`} />
        <p className="text-sm text-gray-500">{uploading ? 'Uploading…' : 'Drop files here or click to browse'}</p>
        <p className="text-xs text-gray-400 mt-1">PDF, Word, Excel, PowerPoint, images</p>
        <input ref={inputRef} type="file" multiple className="hidden"
          accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.png,.jpg,.jpeg,.gif,.csv,.txt"
          onChange={e => handleFiles(e.target.files)} />
      </div>

      {attachments.length > 0 && (
        <ul className="space-y-1.5">
          {attachments.map(att => (
            <li key={att.id} className="flex items-center gap-3 bg-gray-50 border border-gray-200 px-3 py-2.5" style={{ borderRadius: 2 }}>
              {fileIcon(att.type)}
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-[#1A1A1A] truncate">{att.name}</div>
                <div className="text-[11px] text-gray-400">{formatFileSize(att.size)} · {formatDate(att.uploadedAt)}</div>
              </div>
              <button type="button" onClick={() => downloadFile(att.id, att.name)}
                className="p-1.5 text-gray-400 hover:text-[#005B6E] transition-colors" title="Download">
                <Download className="w-4 h-4" />
              </button>
              <button type="button" onClick={() => handleRemove(att.id)}
                className="p-1.5 text-gray-400 hover:text-red-500 transition-colors" title="Remove">
                <X className="w-4 h-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
