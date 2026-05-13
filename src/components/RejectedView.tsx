import { XCircle } from 'lucide-react';
import { Company, STAGE_CONFIG, formatDate } from '../types';

interface Props {
  companies: Company[];
  onSelect: (c: Company) => void;
}

export default function RejectedView({ companies, onSelect }: Props) {
  const cfg = STAGE_CONFIG['rejected'];

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <XCircle className="w-4 h-4 text-red-400" />
        <h2 className="text-sm font-semibold text-[#1A1A1A]">Rejected Companies</h2>
        <span className="text-sm text-gray-400">({companies.length})</span>
      </div>

      {companies.length === 0 ? (
        <div className="bg-white border border-gray-200 py-16 text-center" style={{ borderRadius: 2 }}>
          <XCircle className="w-8 h-8 text-gray-200 mx-auto mb-2" />
          <p className="text-gray-400 text-sm">No rejected companies</p>
        </div>
      ) : (
        <div className="bg-white border border-gray-200 overflow-hidden" style={{ borderRadius: 2 }}>
          <table className="w-full">
            <thead className="border-b border-gray-200">
              <tr>
                {['Company', 'Sector', 'Therapeutic Area', 'Rejection Reason', 'Rejected'].map(h => (
                  <th key={h} className="text-left text-[11px] font-semibold text-gray-500 uppercase tracking-wider py-3 px-4">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {companies.map((company) => (
                <tr
                  key={company.id}
                  onClick={() => onSelect(company)}
                  className="hover:bg-red-50/40 cursor-pointer transition-colors"
                >
                  <td className="py-3 px-4">
                    <div className="flex items-center gap-2">
                      <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${cfg.dot}`} />
                      <div>
                        <div className="font-medium text-[#1A1A1A] text-sm">{company.name}</div>
                        {company.location && <div className="text-[11px] text-gray-400">{company.location}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {company.sector || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-4 text-sm text-gray-600">
                    {company.therapeuticArea || <span className="text-gray-300">—</span>}
                  </td>
                  <td className="py-3 px-4">
                    {company.rejectedReason
                      ? <span className="text-sm text-gray-600">{company.rejectedReason}</span>
                      : <span className="text-gray-300 text-sm">—</span>}
                  </td>
                  <td className="py-3 px-4 text-[11px] text-gray-400">
                    {company.rejectedAt ? formatDate(company.rejectedAt) : formatDate(company.updatedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
