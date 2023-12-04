import LunchMoney, { Asset } from "lunch-money";

export function createAsset(
  lunchMoneyClient: LunchMoney,
  assetName: String
) {
  return lunchMoneyClient.post("/v1/assets", { name: assetName, type: "other", balance: 0.00 });
}