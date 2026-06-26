import { MapPin, Paperclip, ArrowRight, MessageSquare, User, Clock } from 'lucide-react';
import { Company, STAGE_CONFIG, NEXT_STAGE } from '../types';

function formatReminderDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
}

interface Props {
  company: Company;
  onSelect: (c: Company) => void;
  onAdvance?: (id: string) => void;
}

export default function CompanyCard({ company, onSelect, onAdvance }: Props) {
  const cfg = STAGE_CONFIG[company.stage];
  const nextStage = NEXT_STAGE[company.stage];

  return (
    <div
      onClick={() => onSelect(company)}
      className="bg-white border border-gray-200 px-3 py-2.5 cursor-pointer hover:border-[#005B6E]/40 hover:shadow-sm transition-all group rounded-sm"
    >
      {/* Name + owner */}
      <h3 className="font-semibold text-[#1A1A1A] text-sm leading-snug truncate">{company.name}</h3>
      {company.owner && (
        <div className="flex items-center gap-1 mt-0.5 text-[11px] text-gray-400">
          <User className="w-3 h-3 shrink-0" />
          <span className="truncate">{company.owner}</span>
        </div>
      )}

      {/* Badges */}
      {(company.sector || company.therapeuticArea || company.developmentStage) && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {company.sector && (
            <span className="text-[11px] bg-[#E0F0F5] text-[#005B6E] px-1.5 py-0.5 font-medium">
              {company.sector}
            </span>
          )}
          {company.therapeuticArea && (
            <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5">
              {company.therapeuticArea}
            </span>
          )}
          {company.developmentStage && (
            <span className="text-[11px] bg-gray-100 text-gray-600 px-1.5 py-0.5">
              {company.developmentStage}
            </span>
          )}
        </div>
      )}

      {/* Meta */}
      {(company.location || company.fundingStage || company.attachments.length > 0 || company.noteEntries.length > 0) && (
        <div className="flex items-center gap-2 mt-1.5 text-[11px] text-gray-400">
          {company.location && (
            <span className="flex items-center gap-0.5">
              <MapPin className="w-3 h-3" />{company.location}
            </span>
          )}
          {company.fundingStage && (
            <span className={`px-1.5 py-0.5 ${cfg.badgeBg} ${cfg.badgeText} font-medium`}>
              {company.fundingStage}
            </span>
          )}
          <span className="ml-auto flex items-center gap-2">
            {company.attachments.length > 0 && (
              <span className="flex items-center gap-0.5">
                <Paperclip className="w-3 h-3" />{company.attachments.length}
              </span>
            )}
            {company.noteEntries.length > 0 && (
              <span className="flex items-center gap-0.5">
                <MessageSquare className="w-3 h-3" />{company.noteEntries.length}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Backburner reminder */}
      {company.stage === 'backburner' && company.backburnerReminder && (() => {
        const isOverdue = new Date(company.backburnerReminder) < new Date();
        return (
          <div className={`flex items-center gap-1 mt-1.5 text-[11px] font-medium ${isOverdue ? 'text-red-500' : 'text-stone-500'}`}>
            <Clock className="w-3 h-3 shrink-0" />
            Follow up {formatReminderDate(company.backburnerReminder)}
          </div>
        );
      })()}

      {/* Advance button — hidden by default, expands on hover */}
      {onAdvance && nextStage && (
        <div className="max-h-0 overflow-hidden group-hover:max-h-8 transition-all duration-200">
          <button
            onClick={(e) => { e.stopPropagation(); onAdvance(company.id); }}
            className="mt-1.5 w-full flex items-center justify-center gap-1 text-[11px] text-[#005B6E] hover:bg-[#E0F0F5] py-1 transition-colors"
          >
            <ArrowRight className="w-3 h-3" />
            Move to {STAGE_CONFIG[nextStage].label}
          </button>
        </div>
      )}
    </div>
  );
}
