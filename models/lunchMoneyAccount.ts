export type LunchMoneyAccount = {
  name: string;
  type: "employee compensation" | "cash" | "vehicle" | "loan" | "cryptocurrency" | "investment" | "other" | "credit" | "real estate";
  balance: number;
  institutionName: string;
  currency: string;
};