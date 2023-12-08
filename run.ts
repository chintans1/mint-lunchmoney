// github:lunch-money/lunch-money-js

import { LunchMoney, DraftTransaction } from "lunch-money";
import { prettyJSON, readCSV, writeCSV, readJSONFile, parseBoolean } from "./util.js";
import {
  transformAccountCategories,
  addLunchMoneyCategoryIds,
  createLunchMoneyCategories,
} from "./categories.js";
import {
  updateTransactionsWithAccountMappings,
  addLunchMoneyAccountIds,
  createLunchMoneyAccounts,
} from "./accounts.js";
import { applyStandardTransformations } from "./transformations.js";
import dotenv from "dotenv";
import humanInterval from "human-interval";
import dateFns from "date-fns";
import { MintTransaction } from "./models/mintTransaction.js";
import { LunchMoneyAccount } from "./models/lunchMoneyAccount.js";
import fs from "fs";
import PromptSync from "prompt-sync";

const getTransactionsWithMappedCategories = async function(
  mintTransactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  console.log("Read %d transactions", mintTransactions.length);

  const startImportDate = determineStartImportDate();

  const accountMappings: Map<string, LunchMoneyAccount> =
      new Map(readJSONFile("./account_mapping.json")?.accounts);

  const mintTransactionsWithAccountMappings = updateTransactionsWithAccountMappings(
    mintTransactions, accountMappings, startImportDate
  );

  const mintTransactionsWithTransformedCategories =
    await transformAccountCategories(
      mintTransactionsWithAccountMappings,
      lunchMoneyClient,
      "./category_mapping.json"
    );

  return mintTransactionsWithTransformedCategories;
}

export function determineStartImportDate() {
  // TODO this should be an input parameter to the script
  // TODO this isn't really the import date, this is only used to determine when transactions should be treated as old
  let range = humanInterval("1 year");

  if (!range) {
    console.log("Invalid date to search for active accounts");
    process.exit(1);
  }

  // range is in milliseconds
  range /= 1000;

  const oneYearAgo = dateFns.subSeconds(new Date(), range);

  return oneYearAgo;
}

export async function getAndSaveAccountMappings(
  mintTransactions: MintTransaction[]
) {
  // Look at all transactions to fetch the account
  // Now you can map mint account name -> possible LM account
  // Possible LM account = {name, institution name, type, currency, balance}
  const accountMappings = new Map<string, LunchMoneyAccount>();

  console.log(`unique accounts: ${new Set(mintTransactions.map(transaction => transaction.AccountName)).size}`);

  [...new Set(mintTransactions.map(transaction => transaction.AccountName))]
    .forEach(accountName => accountMappings.set(accountName, {
      name: accountName,
      type: "cash",
      balance: 0.00,
      institutionName: "InstitutionName",
      currency: "USD"
    }));

  // Go through transactions again and update the balance
  mintTransactions.forEach(transaction => {
    const amount = parseFloat(transaction.Amount);
    if (accountMappings.has(transaction.AccountName)) {
      const lmAccount: LunchMoneyAccount = accountMappings.get(transaction.AccountName)!;
      lmAccount.balance = transaction.TransactionType === "credit" ? lmAccount.balance + amount : lmAccount.balance - amount;
    }
  });

  console.log(
    `A account_mapping_raw.json has been created to map ${
      accountMappings.size
    } accounts to lunch money:\n`
  );

  fs.writeFileSync(
    "./account_mapping_raw.json",
    prettyJSON({
      accounts: [...accountMappings],
    }),
    "utf8"
  );

  console.log("Make sure to update account_mapping_raw.json to account_mapping.json");
  return accountMappings;
}

export function createAccount(
  mintAccountName: string,
  lmAccount: LunchMoneyAccount,
  lunchMoney: LunchMoney
) {
    console.log(`trying to create account ${lmAccount.currency.toLowerCase()} for mint account ${mintAccountName}`);
    return lunchMoney.post("/v1/assets", {
      "name": lmAccount.name,
      "type_name": lmAccount.type,
      "balance": lmAccount.balance,
      "currency": lmAccount.currency.toLowerCase(),
      "institution_name": lmAccount.institutionName
    });
}

(async () => {
  dotenv.config();

  if (!process.env.LUNCH_MONEY_API_KEY) {
    console.error("Lunch Money API key not set");
    process.exit(1);
  }
  const lunchMoney = new LunchMoney({ token: process.env.LUNCH_MONEY_API_KEY });
  const prompt = PromptSync();

  const mintTransactions = await readCSV("./data.csv");

  if (process.argv[2] === "category-mapping") {
    console.log("Generating category mappings...");
    await getTransactionsWithMappedCategories(mintTransactions, lunchMoney);
    process.exit(0);
  }

  if (process.argv[2] === "account-mapping") {
    console.log("Generating account mappings...");
    await getAndSaveAccountMappings(mintTransactions);
    process.exit(0);
  }

  if (process.argv[2] === "create-account") {
    console.log("Creating accounts...");
    const accountMappings: Map<string, LunchMoneyAccount> =
      new Map(readJSONFile("./account_mapping.json")?.accounts);
    for (const [key, value] of accountMappings) {
      const response = await createAccount(key, value, lunchMoney);
      console.log(`Account created ${key}/${value.name}: ${prettyJSON(response)}`)
    }
    process.exit(0);
  }

  // No command line arguments are given
  // We want to take all mint transactions, apply the category mappings and account mappings
  // After that, we can upload the transactions (ensuring accounts and categories are created)
  const mintTransactionsWithTransformedCategories =
    await getTransactionsWithMappedCategories(mintTransactions, lunchMoney);

  await createLunchMoneyCategories(
    mintTransactionsWithTransformedCategories,
    lunchMoney
  );

  await createLunchMoneyAccounts(
    mintTransactionsWithTransformedCategories,
    lunchMoney
  );

  const mintTransactionsTransformed = applyStandardTransformations(
    mintTransactionsWithTransformedCategories
  );

  const mintTransactionsWithLunchMoneyIds = await addLunchMoneyCategoryIds(
    await addLunchMoneyAccountIds(mintTransactionsTransformed, lunchMoney),
    lunchMoney
  );

  writeCSV(mintTransactionsWithLunchMoneyIds, "./data_transformed.csv");

  console.log("Look at the data_transformed.csv file and ensure everything looks correct.");
  const shouldContinue: boolean = parseBoolean(prompt("If it looks correct, we can proceed. Does it look correct (y/n): "));

  if (!shouldContinue) {
    console.log("Exiting...");
    process.exit(0);
  }

  const BATCH_SIZE = 50;

  console.log(
    `Pushing ${mintTransactionsWithLunchMoneyIds.length} transactions to LunchMoney`
  );
  console.log(
    `This will be done in ${Math.ceil(
      mintTransactionsWithLunchMoneyIds.length / BATCH_SIZE
    )}`
  );

  // page through transactions
  for (
    let i = 0;
    i * BATCH_SIZE < mintTransactionsWithLunchMoneyIds.length;
    i += 1
  ) {
    const batch = mintTransactionsWithLunchMoneyIds.slice(
      i * BATCH_SIZE,
      (i + 1) * BATCH_SIZE
    );

    console.log(
      `Pushing batch ${i} transactions (${batch.length}) to LunchMoney`
    );

    const formattedTransactions = batch.map(
      (transaction) =>
        ({
          payee: transaction.Description,
          notes: transaction.Notes,

          date: transaction.LunchMoneyDate,
          category_id: transaction.LunchMoneyCategoryId,
          amount: transaction.LunchMoneyAmount,
          asset_id: transaction.LunchMoneyAccountId,
          external_id: transaction.LunchMoneyExtId,
          tags: transaction.LunchMoneyTags,

          currency: transaction.LunchMoneyCurrency,
          status: "cleared",
        } as DraftTransaction)
    );

    const result = await lunchMoney.createTransactions(
      formattedTransactions,
      // don't apply rules, user can apply manually
      false,
      // check for recurring expenses
      true,
      // treat negative amounts as debit
      true
    );

    if (result.error) {
      debugger;
    }
  }
})().catch((e) => console.error(e));
