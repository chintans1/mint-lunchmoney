import _ from "underscore";
import { LunchMoney } from "lunch-money";
import { prettyJSON, readJSONFile } from "./util.js";
import { MintTransaction } from "./models/mintTransaction.js";
import { LunchMoneyAccount } from "./models/lunchMoneyAccount.js";
import fs from "fs";

export const ACCOUNT_MAPPING_PATH: string = "./account_mapping.json";

export async function generateAccountMappings(
  mintTransactions: MintTransaction[]
) {
  // Look at all transactions to fetch the account
  // Now you can map mint account name -> possible LM account
  // Possible LM account = {name, institution name, type, currency, balance}
  const accountMappings = new Map<string, LunchMoneyAccount>();

  console.log(`Found ${new Set(mintTransactions.map(transaction => transaction.AccountName)).size} unique accounts`);

  if (fs.existsSync(ACCOUNT_MAPPING_PATH)) {
    console.log("Found existing account mapping file, will try to update only what is required");
    const existingAccountMapping: Map<string, LunchMoneyAccount> = new Map(readJSONFile(ACCOUNT_MAPPING_PATH)?.accounts);
    for (const [key, value] of existingAccountMapping) {
      accountMappings.set(key, value);
    }
  }

  [...new Set(mintTransactions.map(transaction => transaction.AccountName))]
    .forEach(accountName => {
      if (!accountMappings.has(accountName)) {
        accountMappings.set(accountName, {
          name: accountName,
          type: "cash",
          balance: 0.00,
          institutionName: "InstitutionName",
          currency: "USD"
        })
      }
    });

  // Go through transactions again and update the balance
  mintTransactions.forEach(transaction => {
    const amount = parseFloat(transaction.Amount);
    if (accountMappings.has(transaction.AccountName)) {
      const lmAccount: LunchMoneyAccount = accountMappings.get(transaction.AccountName)!;
      lmAccount.balance = transaction.TransactionType === "credit" ? lmAccount.balance + amount : lmAccount.balance - amount;
    }
  });

  console.log(
    `A ${ACCOUNT_MAPPING_PATH} has been created to map ${
      accountMappings.size
    } accounts to lunch money:\n`
  );

  fs.writeFileSync(
    ACCOUNT_MAPPING_PATH,
    prettyJSON({
      accounts: [...accountMappings],
    }),
    "utf8"
  );
}

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