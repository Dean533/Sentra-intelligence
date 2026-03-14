import { FINANCE_KEYWORDS } from "./financeKeywords";

export function isFinanceVideo(title: string, description: string) {
  const text = `${title} ${description}`.toLowerCase();

  for (const keyword of FINANCE_KEYWORDS) {
    if (text.includes(keyword)) {
      return true;
    }
  }

  return false;
}