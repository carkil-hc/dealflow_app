import { Company } from './types';

export async function getCompanies(): Promise<Company[]> {
  const res = await fetch('/api/companies');
  if (!res.ok) throw new Error('Failed to fetch companies');
  return res.json();
}

export async function upsertCompany(company: Company): Promise<void> {
  await fetch(`/api/companies/${company.id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(company),
  });
}

export async function deleteCompany(id: string): Promise<void> {
  await fetch(`/api/companies/${id}`, { method: 'DELETE' });
}
