import _ from "underscore";
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

export async function validateAllAccountsAreExistent(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  // Assuming that transactions are already updated to have correct LM Account Name
  const requiredAccountNames = _.chain(transactions)
    .map(t => t.LunchMoneyAccountName.normalize("NFKC"))
    .uniq()
    .value();

  // assets is only non-plaid assets
  const existingAccountNames = (await lunchMoneyClient.getAssets())
    .map(r => (r.display_name || r.name).normalize("NFKC"));
  // there's a 'cash transaction' account in all LM accounts
  existingAccountNames.push("Cash");

  const accountsToCreate = _.difference(
    requiredAccountNames,
    existingAccountNames
  );

  if (accountsToCreate.length > 0) {
    console.log("There are still accounts to be made, please ensure all accounts are mapped and created.")
    console.log(`Accounts to create:\n\n${accountsToCreate.join("\n")}`);
    process.exit(1);
  }
}

export function updateTransactionsWithAccountMappings(
  transactions: MintTransaction[],
  accountMappings: Map<string, LunchMoneyAccount>
): MintTransaction[] {
  const accountsToFlag = ["Uncategorized"];

  for (const transaction of transactions) {
    if (accountsToFlag.includes(transaction.AccountName)) {
      console.log(`This transaction is uncategorized/cash: ${prettyJSON(transaction)}`);
    }

    transaction.Notes += `\n\n Original Mint account: ${transaction.AccountName}`;
    transaction.LunchMoneyAccountName = `${accountMappings.get(transaction.AccountName)!.name}`;
    transaction.LunchMoneyCurrency = accountMappings.get(transaction.AccountName)!.currency.toLowerCase();
  }

  return transactions;
}

export function createAccount(
  mintAccountName: string,
  lmAccount: LunchMoneyAccount,
  lunchMoney: LunchMoney) {
  console.log(`Trying to create account ${lmAccount.name} for mint account ${mintAccountName}`);
  return lunchMoney.post("/v1/assets", {
    "name": lmAccount.name,
    "type_name": lmAccount.type,
    "balance": lmAccount.balance,
    "currency": lmAccount.currency.toLowerCase(),
    "institution_name": lmAccount.institutionName
  });
}