# Import Mint Transactions Into LunchMoney

[LunchMoney](https://mikebian.co/lunchmoney) is a indie-developed replacement for Mint. Mint has died on the vine post-acquisition, and after it stopped updating my primary bank account, I decided I was going to move off to another system. I've tried personal capital and, just like Mint, it got acquired and seems like it died.

I decided on LunchMoney because of it's awesome API, the fact that it's a paid app, and it's being developed by an indie developer (which, hopefully, means it will get new features and has less of a chance of getting acquired).

Unfortunately, I had years of transactions in Mint and did not want to lose all of that historical data. This script imports Mint transactions into LunchMoney, preserving as much of the original data as possible.

The primary reason I went through all of this trouble is to learn TypeScript. I always enjoy finding a 'learning project' that provides *just* enough motivation to push through the frustration in learning a new language. Please excuse any beginner TS (and submit a PR!).

## What does this do?

* Date, amount, etc transformation to match LunchMoney's expected format
* All imported transactions include a 'mint' tag
* All imported transactions will include a 'MINT-{row-number}` external ID. For this reason, you should only import your mint transactions from a single file
* All accounts without activity in the last ~year *or* intentionally marked as an inactive account
* Ability to specify a mapping between Mint<>LunchMoney for accounts that don't match
* Keep account history from Mint for 'active' accounts. You can't push transactions to a Plaid-managed account, but you can create a manually managed account and then merge it. This is the approach that is taken.

## Usage

1. Download all of your mint transactions in a single CSV. Put it in this directory as `data.csv`
2. Get a lunch money API key. Run `cp .env-example .env` and add your API key to `.env`
3. `asdf install` and `npm install` to setup node & npm packages
4. `tsc .` to compile the typescript
5. `node out/run.js` to run the script

You'll probably need to modify the two files below *after* running `run.js`.

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

# TODO

This is not complete, but should work for someone who wants to import their Mint transactions quickly.

Some things that would be great to fix:

- [ ] Cash & Uncategorized accounts are not handled properly
- [ ] provide confirmation prompt before importing transactions
- [ ] input paths are hardcoded, these should be CLI arguments
- [ ] should create new categories automatically
- [ ] bring over net worth data from Mint.
- [ ] if a asset creation API is built, create these two categories automatically for the user
  - [ ] `Historical Mint Expenses` "Historical expenses from Mint that don't map to an existing account"
  - [ ] `Historical Mint Hidden Expenses` "Historical expenses from Mint that were hidden"
- [ ] the import stuff is messy. There's got to be a better linter for this. https://github.com/lydell/eslint-plugin-simple-import-sort