// github:lunch-money/lunch-money-js

import { LunchMoney, DraftTransaction } from "lunch-money";
import { readCSV, writeCSV, readJSONFile, parseBoolean } from "./util.js";
import {
  CATEGORY_MAPPING_PATH,
  transformAccountCategories,
  addLunchMoneyCategoryIds,
  createLunchMoneyCategories,
  generateCategoryMappings
} from "./categories.js";
import {
  ACCOUNT_MAPPING_PATH,
  generateAccountMappings,
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

async function getTransactionsWithMappedCategories(
  mintTransactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  const accountMappings: Map<string, LunchMoneyAccount> =
    new Map(readJSONFile(ACCOUNT_MAPPING_PATH)?.accounts);

  const mintTransactionsWithAccountMappings = updateTransactionsWithAccountMappings(
    mintTransactions, accountMappings
  );

  const mintTransactionsWithTransformedCategories =
    await transformAccountCategories(
      mintTransactionsWithAccountMappings,
      lunchMoneyClient,
      CATEGORY_MAPPING_PATH
    );

  return mintTransactionsWithTransformedCategories;
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
  console.log("Read %d transactions", mintTransactions.length);

  switch (process.argv[2]) {
    case "category-mapping":
      console.log("Generating category mappings...");
      await generateCategoryMappings(mintTransactions, lunchMoney);
      process.exit(0);

    case "account-mapping":
      console.log("Generating account mappings...");
      await generateAccountMappings(mintTransactions);
      process.exit(0);

    case "create-account":
      console.log("Creating accounts...");
      const accountMappings: Map<string, LunchMoneyAccount> =
        new Map(readJSONFile(ACCOUNT_MAPPING_PATH)?.accounts);
      for (const [key, value] of accountMappings) {
        await createAccount(key, value, lunchMoney);
      }
      process.exit(0);

    default:
      console.log("No specific option chosen via cmdargs...");
      break;
  }

  // Error out if category mapping and/or account mapping isn't present
  if (!fs.existsSync(ACCOUNT_MAPPING_PATH) || !fs.existsSync(CATEGORY_MAPPING_PATH)) {
    console.log("Please ensure you've generated category and account mappings already")
    console.log("You can run 'npm start category-mapping' or 'npm-start account-mapping'");
    process.exit(1);
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
      `Pushing #${i} batch of (${batch.length}) transactions to LunchMoney`
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
