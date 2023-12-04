// github:lunch-money/lunch-money-js

import { LunchMoney, DraftTransaction } from "lunch-money";
import { prettyJSON, readCSV, writeCSV, readJSONFile } from "./util.js";
import {
  transformAccountCategories,
  addLunchMoneyCategoryIds,
  createLunchMoneyCategories,
} from "./categories.js";
import {
  useArchiveForOldAccounts,
  addLunchMoneyAccountIds,
  createLunchMoneyAccounts,
} from "./accounts.js";
import { applyStandardTransformations } from "./transformations.js";
import dotenv from "dotenv";
import humanInterval from "human-interval";
import dateFns from "date-fns";
import { MintTransaction } from "./models/mintTransaction.js";
import fs from "fs";

type LunchMoneyAccount = {
  name: string;
  type: "employee compensation" | "cash" | "vehicle" | "loan" | "cryptocurrency" | "investment" | "other" | "credit" | "real estate";
  balance: number;
  institutionName: string;
  currency: string;
};

const getTransactionsWithMappedCategories = async function(
  mintTransactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  console.log("Read transactions %d", mintTransactions.length);

  const startImportDate = determineStartImportDate();

  const mintTransactionsWithArchiveAccount = useArchiveForOldAccounts(
    mintTransactions,
    startImportDate,
    "./account_mapping.json"
  );

  const mintTransactionsWithTransformedCategories =
    await transformAccountCategories(
      mintTransactionsWithArchiveAccount,
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

  console.log(accountMappings);

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

  return accountMappings;
}

export function createAccountsFromAccountMappings(
  accountMappings: Map<string, LunchMoneyAccount>,
  lunchMoney: LunchMoney
) {
  accountMappings.forEach((lmAccount, mintAccountName) => {
    console.log(`trying to create account ${lmAccount.currency.toLowerCase()} for mint account ${mintAccountName}`);

    let resp;
    const response = lunchMoney.post("/v1/assets", {
      "name": lmAccount.name,
      "type_name": lmAccount.type,
      "balance": lmAccount.balance,
      "currency": lmAccount.currency.toLowerCase(),
      "institution_name": lmAccount.institutionName
    })
      .then(succ => {
        resp = succ;
        console.log(succ);
      })
      .catch(fail => console.log(fail));

    console.log(`resp: ${resp} and response ${response}`);
  });
}

(async () => {
  dotenv.config();

  if (!process.env.LUNCH_MONEY_API_KEY) {
    console.error("Lunch Money API key not set");
    process.exit(1);
  }

  const mintTransactions = await readCSV("./data.csv");
  const lunchMoney = new LunchMoney({ token: process.env.LUNCH_MONEY_API_KEY });

  // if cmd args are for generating cat_mapping only
  if (process.argv[2] === "category-mapping") {
    console.log("category mapping only");
    await getTransactionsWithMappedCategories(mintTransactions, lunchMoney);
    process.exit(0);
  }

  if (process.argv[2] === "account-mapping") {
    console.log("account mapping only");
    await getAndSaveAccountMappings(mintTransactions);
    process.exit(0);
  }

  if (process.argv[2] === "create-account") {
    console.log("create accounts");
    // read from account_mapping.json
    const accountMappings: Map<string, LunchMoneyAccount> = new Map(readJSONFile("./account_mapping.json")?.accounts);
    console.log(`did i read mappings correctly: ${accountMappings.size}`);
    createAccountsFromAccountMappings(accountMappings, lunchMoney);
    process.exit(0);
  }

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

  // TODO should confirm the user actually wants to send everything to LM
  // TODO we should extract this out into a separate function
  // TODO unsure if we can increase the batch size
  // TODO some unknowns about the API that we are guessing on right now:
  //    - https://github.com/lunch-money/developers/issues/11
  //    - https://github.com/lunch-money/developers/issues/10


  const BATCH_SIZE = 100;

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

          currency: "usd",
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
