import { prettyJSON, readJSONFile, parseBoolean } from "./util.js";
import { MintTransaction } from "./models/mintTransaction.js";
import stringSimilarity from "string-similarity";
import { LunchMoney } from "lunch-money";
import _ from "underscore";
import fs from "fs";
import promptSync from "prompt-sync";

type LunchMoneyOutput = {
  category: string;
  tags?: string[];
  income: boolean;
  excludeFromBudget: boolean;
  excludeFromTotals: boolean;
};

interface CategoryMapping {
  [mintCategoryName: string]: LunchMoneyOutput;
}

// Creates category mappings / updates all transactions to store the best possible LM category
export async function transformAccountCategories(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney,
  categoryMappingPath: string
) {
  const lunchMoneyRawCategories = await lunchMoneyClient.getCategories();
  const lunchMoneyCategories = lunchMoneyRawCategories
    .filter((c) => !c.is_group)
    .map((c) => c.name);

  const mintCategories = _.chain(transactions)
    .map((row: any) => row.Category)
    .compact()
    .uniq()
    .value();

  const exactMatches = _.intersection(mintCategories, lunchMoneyCategories);

  // TODO should output this metadata via a tuple or something so this could be an API
  if (exactMatches.length > 0) {
    console.log(
      `Found ${exactMatches.length} exact matches:\n\n${exactMatches.join(
        "\n"
      )}\n`
    );
  } else {
    console.log("No exact matches.\n");
  }

  const userCategoryMapping: CategoryMapping =
    readJSONFile(categoryMappingPath)?.categories || {};

  if (!_.isEmpty(userCategoryMapping)) {
    console.log(`User provided category mapping discovered`);
  }

  const categoriesToMap: { [key: string]: any } = _.chain(mintCategories)
    // exclude exact matches with lunch money categories
    .difference(lunchMoneyCategories)
    .compact()
    // exclude categories that are already mapped
    .difference(_.keys(userCategoryMapping))
    // attempt to pick the best match in LM for Mint categories
    // bestMatch: {
    //   rating:0.5333333333333333,
    //   target:'Business Expenses'
    // }
    .map((mintCategoryName: string) => {
      return _.isEmpty(lunchMoneyCategories)
      ? {
        [mintCategoryName]: {
          category: mintCategoryName,
          tags: {}
        }
      } :
      {
        [mintCategoryName]: {
          category: stringSimilarity.findBestMatch(mintCategoryName, lunchMoneyCategories).bestMatch.target,
          tags: {}
        }
      };
    })
    // merge array of objects into one object
    .reduce((acc: Object, curr: Object) => _.extend(acc, curr), {})
    .value();

  if (!_.isEmpty(categoriesToMap)) {
    if (!_.isEmpty(userCategoryMapping)) {
      console.log(
        `Additional categories must be mapped.\n${prettyJSON(categoriesToMap)}`
      );
    } else {
      console.log(
        `A category_mapping.json has been created to map ${
          _.keys(categoriesToMap).length
        } mint categories to lunch money:\n`
      );

      fs.writeFileSync(
        categoryMappingPath,
        prettyJSON({
          categories: categoriesToMap,
          lunchMoneyOptions: lunchMoneyCategories,
        }),
        "utf8"
      );

      process.exit(1);
    }
  }

  return updateMintTransactionsWithOldNewCategoryInfo(transactions, userCategoryMapping);
}

export async function addLunchMoneyCategoryIds(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  const lunchMoneyCategories = await lunchMoneyClient.getCategories();
  const lunchMoneyCategoryMapping = lunchMoneyCategories
    .filter((c) => !c.is_group)
    .reduce((acc: { [key: string]: number }, curr: any) => {
      acc[curr.name] = curr.id;
      return acc;
    }, {});

  for (const transaction of transactions) {
    if (transaction.LunchMoneyCategoryName === "Uncategorized") {
      console.log(`Transaction ${transaction.Description} from ${transaction.Date} is uncategorized`);
    }

    transaction.LunchMoneyCategoryId =
      lunchMoneyCategoryMapping[transaction.LunchMoneyCategoryName];
  }

  return transactions;
}

export async function createLunchMoneyCategories(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  const prompt = promptSync();
  const createCategories = parseBoolean(prompt("Do you want to create categories (y/n): "));
  if (!createCategories) {
    console.log("No categories are being created, exiting...");
    process.exit(1);
  }

  const categoryMappings: CategoryMapping = readJSONFile("./category_mapping.json")["categories"];

  const uniqueMintCategories = _.chain(transactions)
    .map(t => t.Category)
    .uniq()
    .value();

  const uniqueCategories = _.chain(transactions)
    .map(t => t.LunchMoneyCategoryName)
    .uniq()
    .value();

  const rawLunchMoneyCategories = await lunchMoneyClient.getCategories();
  const lmCategoryGroupNames = rawLunchMoneyCategories
    .filter(c => c.is_group)
    .map(c => c.name);
  const lmCategoryNames = rawLunchMoneyCategories
    .filter(c => !c.is_group)
    .map(c => c.name);

  // this category maps to no category
  lmCategoryNames.push("Uncategorized");

  // make sure group names are different from category names
  const groupConflicts = _.intersection(uniqueCategories, lmCategoryGroupNames);
  if (!_.isEmpty(groupConflicts)) {
    console.log(
      `Group names must be different from category names:\n${groupConflicts.join(
        ", "
      )}`
    );
    process.exit(1);
  }

  const categoriesToCreate = _.difference(uniqueCategories, lmCategoryNames);

  uniqueMintCategories
    .map(mintCategory => {
      console.log(`category mapping for ${mintCategory} is ${JSON.stringify(categoryMappings[mintCategory])}`);
      return categoryMappings[mintCategory] || mintCategory;
    })
    .filter(lmCategory => categoriesToCreate.includes(lmCategory.category))
    .forEach(lmCategory => {
      lunchMoneyClient.createCategory(lmCategory.category || lmCategory.toString(), "N/A", lmCategory.income || false, lmCategory.excludeFromBudget || false, lmCategory.excludeFromTotals || false);
    });
}

const updateMintTransactionsWithOldNewCategoryInfo = function(
  mintTransactions: MintTransaction[],
  userCategoryMappings: CategoryMapping
) {
  return mintTransactions.map(ogTransaction => {
    const transaction = Object.assign(ogTransaction);

    if (transaction.Category in userCategoryMappings) {
      transaction.Notes += `\n\nOriginal Mint category: ${transaction.Category}`;
      const outputMapping = userCategoryMappings[transaction.Category];
      if (typeof outputMapping === "string") {
        transaction.LunchMoneyCategoryName = outputMapping;
      } else {
        transaction.LunchMoneyCategoryName = outputMapping.category;
        transaction.LunchMoneyTags = outputMapping.tags || ["uncategorized"];
      }
    } else {
      transaction.LunchMoneyCategoryName = transaction.Category;
    }

    return transaction;
  });
}
