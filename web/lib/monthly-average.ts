export function recordedMonthlyAverage<T extends { hasActivity: boolean; income: number; spending: number }>(months: T[]) {
  const recorded = months.filter((month) => month.hasActivity);
  const count = recorded.length;
  return {
    months: recorded,
    count,
    income: count ? recorded.reduce((sum, month) => sum + month.income, 0) / count : 0,
    spending: count ? recorded.reduce((sum, month) => sum + month.spending, 0) / count : 0,
  };
}
