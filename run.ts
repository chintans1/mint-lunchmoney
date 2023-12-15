// github:lunch-money/lunch-money-js

import { LunchMoney, DraftTransaction } from "lunch-money";
import { prettyJSON, readCSV, writeCSV, readJSONFile, parseBoolean } from "./util.js";
import {
  transformAccountCategories,
  addLunchMoneyCategoryIds,
  createLunchMoneyCategories,
  generateCategoryMappings
} from "./categories.js";
import {
  updateTransactionsWithAccountMappings,
  addLunchMoneyAccountIds,
  validateAllAccountsAreExistent,
  createAccount
} from "./accounts.js";
import { applyStandardTransformations } from "./transformations.js";
import dotenv from "dotenv";
import { MintTransaction } from "./models/mintTransaction.js";
import { LunchMoneyAccount } from "./models/lunchMoneyAccount.js";
import fs from "fs";
import PromptSync from "prompt-sync";

const getTransactionsWithMappedCategories = async function(
  mintTransactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  console.log("Read %d transactions", mintTransactions.length);

  const accountMappings: Map<string, LunchMoneyAccount> =
      new Map(readJSONFile("./account_mapping.json")?.accounts);

  const mintTransactionsWithAccountMappings = updateTransactionsWithAccountMappings(
    mintTransactions, accountMappings
  );

  const mintTransactionsWithTransformedCategories =
    await transformAccountCategories(
      mintTransactionsWithAccountMappings,
      lunchMoneyClient,
      "./category_mapping.json"
    );

  return mintTransactionsWithTransformedCategories;
}

export async function getAndSaveAccountMappings(
  mintTransactions: MintTransaction[]
) {
  // Look at all transactions to fetch the account
  // Now you can map mint account name -> possible LM account
  // Possible LM account = {name, institution name, type, currency, balance}
  const accountMappings = new Map<string, LunchMoneyAccount>();

  console.log(`Found ${new Set(mintTransactions.map(transaction => transaction.AccountName)).size} unique accounts`);

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
    await generateCategoryMappings(mintTransactions, lunchMoney);
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
      await createAccount(key, value, lunchMoney);
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

  await validateAllAccountsAreExistent(
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
