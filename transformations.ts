import PromptSync from "prompt-sync";
import { MintTransaction } from "./models/mintTransaction";
import { parseBoolean } from "./util";
import dateFns from "date-fns";

function addExtIds(transactions: MintTransaction[]) {
  let mintIdIterator = 0;

  for (const transaction of transactions) {
    transaction.LunchMoneyExtId = `MINT-${mintIdIterator}`;
    mintIdIterator++;
  }

  return transactions;
}

function addMintTag(transactions: MintTransaction[]) {
  for (const transaction of transactions) {
    if (!Array.isArray(transaction.LunchMoneyTags)) {
      transaction.LunchMoneyTags = [];
    }

    transaction.LunchMoneyTags = [
      ...transaction.LunchMoneyTags,
      "mint",
    ];
  }

  return transactions;
}

function trimNotes(transactions: MintTransaction[]) {
  for (const transaction of transactions) {
    transaction.Notes = transaction.Notes.trim();
  }

  return transactions;
}

function flipSigns(transactions: MintTransaction[]) {
  for (const transaction of transactions) {
    if (transaction.TransactionType === "debit") {
      transaction.LunchMoneyAmount = `-${transaction.Amount}`;
    } else {
      transaction.LunchMoneyAmount = transaction.Amount;
    }
  }

  return transactions;
}

function transformDates(transactions: MintTransaction[]) {
  for (const transaction of transactions) {
    transaction.LunchMoneyDate = dateFns.format(
      // https://github.com/date-fns/date-fns/blob/master/docs/unicodeTokens.md
      dateFns.parse(transaction.Date, "MM/dd/yyyy", new Date()),
      "yyyy-MM-dd"
    );
  }

  return transactions;
}

export function applyStandardTransformations(transactions: MintTransaction[]) {
  const prompt = PromptSync();
  const addMintTags: Boolean = parseBoolean(prompt(`Do you want to add a "Mint" tag to all transactions (y/n): `));

  const transformedTransactions = addExtIds(trimNotes(flipSigns(transformDates(transactions))));
  return addMintTags ? addMintTag(transformedTransactions) : transformedTransactions;
}
