# Import Mint Transactions Into LunchMoney
### Forked from https://github.com/iloveitaly/mint-lunchmoney

[LunchMoney](https://lunchmoney.app) is a indie-developed replacement for Mint. Mint has died in favour of Credit Karma.

Unfortunately, I had years of transactions in Mint and did not want to lose all of that historical data. This script imports Mint transactions into LunchMoney, preserving as much of the original data as possible.

Feel free to open a PR to fix anything or add any new functionality. I am not the best at TypeScript so there is probably a lot of room for improvement.

## What does this do?

* Date, amount, etc transformation to match LunchMoney's expected format
* All imported transactions can include a 'mint' tag
* All imported transactions will include a 'MINT-{row-number}` external ID. For this reason, you should only import your mint transactions from a single file

* Ability to specify a category mapping between Mint <> LunchMoney
  * Ability to tag all transactions under a category and mark category as income or excluding from budget/totals is beneficial here
* Ability to specify a mapping between Mint <> LunchMoney for accounts
  * Try to calculate the most accurate balance for each account dependent on transactions
* Keep account history from Mint for 'active' accounts. You can't push transactions to a Plaid-managed account, but you can create a manually managed account and then merge it. This is the approach that is taken.

## Usage

1. Download all of your mint transactions in a single CSV. Put it in this directory as `data.csv`
2. Get a lunch money API key. Run `cp .env-example .env` and add your API key to `.env`
3. `asdf install` and `npm install` to setup node & npm packages
4. `npm run build`, `npm start` to build and run!

You'll probably need to modify the two files below *after* running.

#### category_mapping.json

Use this file to map Mint categories to LunchMoney categories. This file will be autogenerated for you when you first run this script.

```json
{
  "categories": {
    "MintCategory": "LunchMoneyCategory",
    "MintCategory2": {"category": "LM Category 2", "tags": ["foo"]}
  }
}
```

#### account_mapping.json

You can use this file to archive specific accounts that are still being reported as 'active':

```json
{
  "archive": [
    "account 1",
    "account 2"
  ]
}
```

### TODO
This is not complete, but should work for someone who wants to import their Mint transactions quickly.

Some things that would be great to fix:
- [ ] Clean up code and update README
- [ ] Ensure Cash & Uncategorized accounts are handled properly
- [ ] input paths are hardcoded, these should be CLI arguments (i don't think so)
- [ ] bring over net worth data from Mint
- [ ] the import stuff is messy. There's got to be a better linter for this. https://github.com/lydell/eslint-plugin-simple-import-sort