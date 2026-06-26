import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Company, ACTIVE_STAGES, STAGE_CONFIG, NEXT_STAGE, Stage } from '../types';
import CompanyCard from './CompanyCard';

interface Props {
  companies: Company[];
  onSelect: (c: Company) => void;
  onStageChange: (id: string, stage: Stage) => void;
  onAdd: () => void;
}

export default function KanbanView({ companies, onSelect, onStageChange, onAdd }: Props) {
  const [draggedId, setDraggedId] = useState<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<Stage | null>(null);

  const handleAdvance = (id: string, currentStage: Stage) => {
    const next = NEXT_STAGE[currentStage];
    if (next) onStageChange(id, next);
  };

  const handleDragStart = (e: React.DragEvent, id: string) => {
    setDraggedId(id);
    e.dataTransfer.setData('text/plain', id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragEnd = () => {
    setDraggedId(null);
    setDragOverStage(null);
  };

  const handleDragOver = (e: React.DragEvent, stage: Stage) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverStage(stage);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the column entirely (not entering a child element)
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverStage(null);
    }
  };

  const handleDrop = (e: React.DragEvent, stage: Stage) => {
    e.preventDefault();
    const id = e.dataTransfer.getData('text/plain');
    const company = companies.find(c => c.id === id);
    if (id && company && company.stage !== stage) {
      onStageChange(id, stage);
    }
    setDraggedId(null);
    setDragOverStage(null);
  };

  return (
    <div className="flex gap-3 overflow-x-auto pb-4" style={{ height: 'calc(100vh - 196px)' }}>
      {ACTIVE_STAGES.map((stage) => {
        const cfg = STAGE_CONFIG[stage];
        const stageCompanies = companies.filter((c) => c.stage === stage);
        const isOver = dragOverStage === stage;
        const isDraggingFromHere = draggedId && companies.find(c => c.id === draggedId)?.stage === stage;

        return (
          <div
            key={stage}
            onDragOver={e => handleDragOver(e, stage)}
            onDragLeave={handleDragLeave}
            onDrop={e => handleDrop(e, stage)}
            className={`flex-none w-[272px] h-full flex flex-col border overflow-hidden transition-colors ${
              isOver && !isDraggingFromHere
                ? 'border-[#005B6E] bg-[#E0F0F5]/30'
                : 'border-gray-200 bg-white'
            } rounded-sm`}
          >
            {/* Column header */}
            <div className={`${cfg.headerBg} px-4 py-2.5 border-b border-gray-200`}>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2 h-2 rounded-full ${cfg.dot}`} />
                  <h2 className={`font-semibold text-sm ${cfg.headerText}`}>{cfg.label}</h2>
                </div>
                <span className={`text-xs font-semibold ${cfg.headerText} opacity-60`}>
                  {stageCompanies.length}
                </span>
              </div>
            </div>

            {/* Cards */}
            <div className="flex-1 overflow-y-auto p-3 space-y-2.5 scrollbar-thin bg-[#FAFAFA]">
              {/* Add button — only in the New column */}
              {stage === 'new' && (
                <button
                  onClick={onAdd}
                  className="w-full flex items-center justify-center gap-1.5 border border-dashed border-gray-300 hover:border-[#005B6E] hover:text-[#005B6E] text-gray-400 text-sm py-2.5 transition-colors bg-white rounded-sm"
                >
                  <Plus className="w-4 h-4" />
                  Add Company
                </button>
              )}
              {stageCompanies.length === 0 ? (
                <div className={`text-center py-10 text-xs transition-colors ${
                  isOver && !isDraggingFromHere ? 'text-[#005B6E]' : 'text-gray-300'
                }`}>
                  {isOver && !isDraggingFromHere ? 'Drop here' : 'No companies'}
                </div>
              ) : (
                stageCompanies.map((company) => (
                  <div
                    key={company.id}
                    draggable
                    onDragStart={e => handleDragStart(e, company.id)}
                    onDragEnd={handleDragEnd}
                    className={`transition-opacity ${draggedId === company.id ? 'opacity-40' : 'opacity-100'}`}
                    style={{ cursor: 'grab' }}
                  >
                    <CompanyCard
                      company={company}
                      onSelect={onSelect}
                      onAdvance={
                        NEXT_STAGE[company.stage]
                          ? (id) => handleAdvance(id, company.stage)
                          : undefined
                      }
                    />
                  </div>
                ))
              )}

              {/* Drop target hint when dragging over a non-empty column */}
              {isOver && !isDraggingFromHere && stageCompanies.length > 0 && (
                <div className="border-2 border-dashed border-[#005B6E]/40 rounded py-3 text-center text-xs text-[#005B6E]/60">
                  Drop here
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
