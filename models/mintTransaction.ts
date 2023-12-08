/*
Account Name:'Amazon'
Amount:'16.11'
Category:'Books'
Date:'10/02/2021'
Description:'Audible.com'
Labels:''
Notes:''
Original Description:'Audible'
Transaction Type:'debit'
*/

export interface MintTransaction {
  AccountName: string;
  Amount: string;
  Category: string;
  Date: string;
  Description: string;
  Labels: string;
  Notes: string;
  OriginalDescription: string;
  TransactionType: string;

  // additional fields for LM import
  LunchMoneyTags: string[];
  LunchMoneyAccountId: number;
  LunchMoneyAccountName: string;
  LunchMoneyCategoryId: number;
  LunchMoneyCategoryName: string;
  LunchMoneyExtId: string;
  LunchMoneyAmount: string;
  LunchMoneyDate: string;
  LunchMoneyCurrency: string;
}