import _ from "underscore";
import dateFns from "date-fns";
import { LunchMoney, Asset } from "lunch-money";
import { readJSONFile, prettyJSON } from "./util.js";
import { MintTransaction } from "./models/mintTransaction.js";
import { LunchMoneyAccount } from "./models/lunchMoneyAccount.js";
import { createAsset } from "./clients/lunchMoneyClient.js";

export async function addLunchMoneyAccountIds(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
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
    console.log(`trying to create account ${account}`);
    createAsset(lunchMoneyClient, account)
  });

  if (!_.isEmpty(accountsToCreate)) {
    console.log(`Create these accounts:\n\n${accountsToCreate.join("\n")}`);
    process.exit(1);
  }
}

export function updateTransactionsWithAccountMappings(
  transactions: MintTransaction[],
  accountMappings: Map<string, LunchMoneyAccount>,
  oldTransactionDate: Date
): MintTransaction[] {
  const [oldTransactions, recentTransactions] = _.partition(transactions,
    t => dateFns.isBefore(dateFns.parse(t.Date, "MM/dd/yyyy", new Date()), oldTransactionDate));

  const allInactiveMintAccounts = _.chain(oldTransactions)
    .map(t => t.AccountName)
    .compact()
    .uniq()
    .value();
  console.log(`Determined these Mint Accounts to be old and probably should be archived:\n\n ${allInactiveMintAccounts.join("\n")}`);
  console.log(`Will save these inactive accounts to inactive_accounts.json, feel free to mark it inactive in LunchMoney`);

  const accountsToSkip = ["Uncategorized"];

  for (const transaction of transactions) {
    if (accountsToSkip.includes(transaction.AccountName)) {
      console.log(`This transaction is uncategorized/cash: ${prettyJSON(transaction)}`);
      // transaction.LunchMoneyAccountName = transaction.AccountName;
    }

    transaction.Notes += `\n\n Original Mint account: ${transaction.AccountName}`;
    transaction.LunchMoneyAccountName = `${accountMappings.get(transaction.AccountName)?.name || "Could not find mapping"}`;
  }

  return transactions;
}

export function useArchiveForOldAccounts(
  transactions: MintTransaction[],
  // the date at which you want to treat transactions as old
  oldTransactionDate: Date,
  accountMappingPath: string
): MintTransaction[] {
  const [oldTransactions, recentTransactions] = _.partition(transactions, (t) =>
    dateFns.isBefore(
      dateFns.parse(t.Date, "MM/dd/yyyy", new Date()),
      oldTransactionDate
    )
  );

  const allActiveMintAccounts = _.chain(recentTransactions)
    .map((t) => t.AccountName)
    .compact()
    .uniq()
    .value();

  const allInactiveMintAccounts = _.chain(oldTransactions)
    .map((t) => t.AccountName)
    .compact()
    .uniq()
    .difference(allActiveMintAccounts)
    .value();

  console.log(
    `Merging the following accounts into a 'Mint Archive' account:\n\n${allInactiveMintAccounts.join(
      "\n"
    )}\n`
  );

  console.log(
    `Found ${
      allActiveMintAccounts.length
    } active accounts:\n\n${allActiveMintAccounts.join("\n")}\n`
  );

  const userSpecifiedArchiveAccounts =
    readJSONFile(transactionMappingPath) || [];

  const accountsToArchive = allInactiveMintAccounts.concat(
    userSpecifiedArchiveAccounts
  );

  // TODO these are properly skipped but we don't map these to the right thing in LM
  const accountsToSkip = ["Uncategorized", "Cash"];

  for (const transaction of transactions) {
    if (accountsToSkip.includes(transaction.AccountName)) {
      transaction.LunchMoneyAccountName = transaction.AccountName;
      continue;
    }

    if (accountsToArchive.includes(transaction.AccountName)) {
      transaction.Notes += `\n\nOriginal Mint account: ${transaction.AccountName}`;
      transaction.LunchMoneyAccountName = "Mint Archive";
    } else {
      transaction.LunchMoneyAccountName = `${transaction.AccountName} (Mint)`;
    }
  }

  return transactions;
}
