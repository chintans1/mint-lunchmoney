import { prettyJSON, readJSONFile, parseBoolean } from "./util.js";
import { MintTransaction } from "./models/mintTransaction.js";
import { CategoryGroupMapping } from "./models/categoryGroupMapping.js";
import { CategoryMapping } from "./models/categoryMapping.js";
import stringSimilarity from "string-similarity";
import { LunchMoney } from "lunch-money";
import _ from "underscore";
import fs from "fs";
import promptSync from "prompt-sync";

export const CATEGORY_MAPPING_PATH: string = "./category_mapping.json";

interface CategoryMappings {
  [mintCategoryName: string]: CategoryMapping;
}

interface CategoryGroupMappings {
  [categoryGroupName: string]: CategoryGroupMapping;
}

export async function generateCategoryMappings(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney
) {
  if (fs.existsSync(CATEGORY_MAPPING_PATH)) {
    console.log(`Category mapping file already exists, exiting to avoid overwriting...`);
    process.exit(1);
  }

  const lunchMoneyRawCategories = await lunchMoneyClient.getCategories();
  const lunchMoneyGroupCategories: { [key: string]: any } = lunchMoneyRawCategories
    .filter(c => c.is_group)
    .map(c => [c.name, {
      categoryGroup: c.name,
      income: c.is_income,
      excludeFromBudget:c.exclude_from_budget,
      excludeFromTotals: c.exclude_from_totals
    }]);

  const lunchMoneyCategories = lunchMoneyRawCategories
    .filter(c => !c.is_group)
    .map(c => c.name);

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

  const categoriesToMap: { [key: string]: any } = _.chain(mintCategories)
    // exclude exact matches with lunch money categories
    .difference(lunchMoneyCategories)
    .compact()
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

  if (_.isEmpty(categoriesToMap)) {
    console.log(`No categories were found to map`);
    process.exit(0);
  }

  console.log(
    `A ${CATEGORY_MAPPING_PATH} has been created to map ${
      _.keys(categoriesToMap).length
    } mint categories to lunch money:\n`
  );

  fs.writeFileSync(
    CATEGORY_MAPPING_PATH,
    prettyJSON({
      categories: categoriesToMap,
      lunchMoneyOptions: lunchMoneyCategories,
      categoryGroups: lunchMoneyGroupCategories
    }),
    "utf8"
  );
  process.exit(0);
}

// Updates all transactions to store the best possible LM category
export async function transformAccountCategories(
  transactions: MintTransaction[],
  lunchMoneyClient: LunchMoney,
  categoryMappingPath: string
) {
  const lunchMoneyRawCategories = await lunchMoneyClient.getCategories();
  const lunchMoneyCategories = lunchMoneyRawCategories
    .filter(c => !c.is_group)
    .map(c => c.name);

  const mintCategories = _.chain(transactions)
    .map((row: any) => row.Category)
    .compact()
    .uniq()
    .value();


  const userCategoryMapping: CategoryMappings =
    readJSONFile(categoryMappingPath)?.categories || {};

  if (!_.isEmpty(userCategoryMapping)) {
    console.log(`User provided category mapping discovered`);
  } else {
    console.log(`User has no category mappings available, please create. Now exiting...`);
    process.exit(1)
  }

  const categoriesLeftToMap: { [key: string]: any } = _.chain(mintCategories)
    // exclude exact matches with lunch money categories
    .difference(lunchMoneyCategories)
    .compact()
    // exclude categories that are already mapped
    .difference(_.keys(userCategoryMapping))
    // merge array of objects into one object
    .reduce((acc: Object, curr: Object) => _.extend(acc, curr), {})
    .value();

  if (!_.isEmpty(categoriesLeftToMap)) {
    console.log(
      `Additional categories must be mapped.\n${prettyJSON(categoriesLeftToMap)}\n\nTry to generate category mapping again.`
    )
    process.exit(1);
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

  const categoryMappings: CategoryMappings = readJSONFile(CATEGORY_MAPPING_PATH)["categories"];
  const categoryGroupMappings: CategoryGroupMappings = readJSONFile(CATEGORY_MAPPING_PATH)["categoryGroups"];
  const rawLunchMoneyCategories = await lunchMoneyClient.getCategories();

  const categoryGroups: string[] = [];
  for (const categoryGroup in categoryGroupMappings) {
    categoryGroups.push(categoryGroup);
  }
  const existingCategoryGroups = rawLunchMoneyCategories
    .filter(c => c.is_group)
    .map(c => c.name);

  // Lets create all possible category groups first
  // After that, we can map the category group name -> id
  const categoryGroupsToCreate = _.difference(categoryGroups, existingCategoryGroups);
  const categoryGroupIdMapping: Map<string, Number> = new Map(rawLunchMoneyCategories
    .filter(c => c.is_group)
    .map(c => [c.name, c.id]));

  for (const categoryGroupName of categoryGroupsToCreate) {
    console.log(`Trying to create category group ${categoryGroupName}`);
    const categoryGroup = categoryGroupMappings[categoryGroupName];
    const response = await lunchMoneyClient.post("/v1/categories/group", {
      name: categoryGroup.categoryGroup,
      is_income: categoryGroup.income || false,
      exclude_from_budget: categoryGroup.excludeFromBudget || false,
      exclude_from_totals: categoryGroup.excludeFromTotals || false,
    });
    categoryGroupIdMapping.set(categoryGroupName, response?.category_id);
  }

  console.log(categoryGroupIdMapping);

  const uniqueMintCategories = _.chain(transactions)
    .map(t => t.Category)
    .uniq()
    .value();
  const uniqueCategories = _.chain(transactions)
    .map(t => t.LunchMoneyCategoryName)
    .uniq()
    .value();
  const lmCategoryNames = rawLunchMoneyCategories
    .filter(c => !c.is_group)
    .map(c => c.name);

  // this category maps to no category (TODO)
  lmCategoryNames.push("Uncategorized");

  // make sure group names are different from category names
  const existingGroupConflicts = _.intersection(uniqueCategories, existingCategoryGroups);
  const possibleGroupConflicts = _.intersection(uniqueCategories, categoryGroups);
  if (!_.isEmpty(existingGroupConflicts) || !_.isEmpty(possibleGroupConflicts)) {
    console.log(
      `Group names must be different from category names:\n
        ${existingGroupConflicts.concat(categoryGroups).join(
        ", "
      )}`
    );
    process.exit(1);
  }

  const categoriesToCreate = _.difference(uniqueCategories, lmCategoryNames);

  uniqueMintCategories
    .map(mintCategory => categoryMappings[mintCategory] || mintCategory)
    .filter(lmCategory => categoriesToCreate.includes(lmCategory.category))
    .forEach(lmCategory => {
      // TODO: pass in group_id if available
      lunchMoneyClient.post("/v1/categories", {
        name: lmCategory.category || lmCategory.toString(),
        is_income: lmCategory.income || false,
        exclude_from_budget: lmCategory.excludeFromBudget || false,
        exclude_from_totals: lmCategory.excludeFromTotals || false,
        group_id: categoryGroupIdMapping.get(lmCategory.categoryGroup)
      });
      // lunchMoneyClient.createCategory(lmCategory.category || lmCategory.toString(), "N/A", lmCategory.income || false, lmCategory.excludeFromBudget || false, lmCategory.excludeFromTotals || false);
    });
}

const updateMintTransactionsWithOldNewCategoryInfo = function(
  mintTransactions: MintTransaction[],
  userCategoryMappings: CategoryMappings
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
