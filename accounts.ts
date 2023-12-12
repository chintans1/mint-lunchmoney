import _ from "underscore";
import dateFns from "date-fns";
import { LunchMoney } from "lunch-money";
import { prettyJSON } from "./util.js";
import { MintTransaction } from "./models/mintTransaction.js";
import { LunchMoneyAccount } from "./models/lunchMoneyAccount.js";

export async function addLunchMoneyAccountIds(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  // Assuming that transactions are already updated to have correct LM Account Name
  const manualLmAssets = await lunchMoneyClient.getAssets();
  const manualLmAssetMapping = _.reduce(
    manualLmAssets,
    (acc: { [key: string]: number }, asset) => {
      // without normalize, accounts with utf8 characters will not be properly matched
      acc[(asset.display_name || asset.name).normalize("NFKC")] = asset.id;
      return acc;
    },
    {}
  );

  for (const transaction of transactions) {
    transaction.LunchMoneyAccountId =
      manualLmAssetMapping[transaction.LunchMoneyAccountName.normalize("NFKC")];
  }

  return transactions;
}

export async function createLunchMoneyAccounts(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  // Assuming that transactions are already updated to have correct LM Account Name
  const mintAccountsAfterTransformation = _.chain(transactions)
    .map((t) => t.LunchMoneyAccountName.normalize("NFKC"))
    .uniq()
    .value();

  // assets is only non-plaid assets
  const manualLmAssets = await lunchMoneyClient.getAssets();
  const existingAccountNames = manualLmAssets.map((r) =>
    (r.display_name || r.name).normalize("NFKC")
  );

  // there's a 'cash transaction' account in all LM accounts
  existingAccountNames.push("Cash");

  const accountsToCreate = _.difference(
    mintAccountsAfterTransformation,
    existingAccountNames
  );

  accountsToCreate.forEach(account => {
    console.log(`Trying to create account ${account}`);
    // TODO
  });
}

export function updateTransactionsWithAccountMappings(
  transactions: MintTransaction[],
  accountMappings: Map<string, LunchMoneyAccount>
): MintTransaction[] {
  const accountsToFlag = ["Uncategorized"];

  for (const transaction of transactions) {
    if (accountsToFlag.includes(transaction.AccountName)) {
      console.log(`This transaction is uncategorized/cash: ${prettyJSON(transaction)}`);
      // transaction.LunchMoneyAccountName = transaction.AccountName;
    }

    transaction.Notes += `\n\n Original Mint account: ${transaction.AccountName}`;
    transaction.LunchMoneyAccountName = `${accountMappings.get(transaction.AccountName)?.name || "Could not find mapping"}`;
    transaction.LunchMoneyCurrency = accountMappings.get(transaction.AccountName)?.currency.toLowerCase() || "usd";
  }

  return transactions;
}